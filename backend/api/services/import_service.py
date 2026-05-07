"""Dataset import — parse a CSV/XLSX, preview it, and atomically replace
questions + applications when the operator confirms column mappings.

Two entry points:
- parse(): preview-only. Stateless; the file is not stored. Returns sheet info
  + a small preview suitable for the wizard UI.
- import_dataset(): atomic. Re-receives the file with the operator's mappings
  and replaces the project's question schema + applications in one transaction.

State guard: refuses both operations if `project.state != 'setup'`. Once the
project advances past setup, downstream metrics depend on the dataset; quiet
re-imports would invalidate them. Operators clone the project to start over.
"""

import io
import json
import logging
from typing import Any

import pandas as pd

from db_models import (
    Application,
    ApplicationRepository,
    AuditLogRepository,
    Question,
    QuestionRepository,
    ProjectRepository,
)

logger = logging.getLogger("scoring_ai.services.import")


# OSS-version safety limits. Configurable later via env if needed.
MAX_FILE_BYTES = 10 * 1024 * 1024   # 10 MB
MAX_ROWS = 5_000
MAX_COLUMNS = 100
PREVIEW_ROWS = 25                   # how many rows to send back in /parse

VALID_ROLES = {"id", "question", "demographic", "metadata", "exclude"}


class ImportError(ValueError):
    """User-facing import failure. Routes turn this into HTTP 400."""


class ImportService:
    def __init__(self):
        self.project_repo = ProjectRepository()
        self.question_repo = QuestionRepository()
        self.app_repo = ApplicationRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Preview                                                            #
    # ------------------------------------------------------------------ #

    def parse(
        self,
        project_id: int,
        file_bytes: bytes,
        filename: str,
    ) -> dict:
        """Return sheet metadata + a small preview. Never persists the file."""
        self._require_setup_state(project_id)
        self._validate_size(file_bytes)
        fmt = _detect_format(filename)

        if fmt == "csv":
            # header=None: every row stays in the dataframe so the operator
            # can choose which row holds questions in the wizard.
            preview_df = _read_csv(file_bytes, header=None, nrows=PREVIEW_ROWS)
            full_row_count = _count_csv_rows(file_bytes)
            sheet = "(csv)"
            sheets = [{
                "name": sheet,
                "rows": full_row_count,
                "columns": int(preview_df.shape[1]) if preview_df.shape[1] else 0,
            }]
            preview = {
                "name": sheet,
                "total_rows": full_row_count,
                "rows": _df_to_preview_rows(preview_df),
            }
            return {
                "format": "csv",
                "sheets": sheets,
                "suggested_sheet": sheet,
                "preview": preview,
            }

        # xlsx
        xlsx = _open_xlsx(file_bytes)
        sheets = []
        for name in xlsx.sheet_names:
            df = xlsx.parse(name, header=None, nrows=0)
            full_df = xlsx.parse(name, header=None)
            sheets.append({
                "name": name,
                "rows": int(full_df.shape[0]),
                "columns": int(full_df.shape[1] if full_df.shape[1] else len(df.columns)),
            })
        suggested = xlsx.sheet_names[0]
        preview_df = xlsx.parse(suggested, header=None, nrows=PREVIEW_ROWS)
        full_df = xlsx.parse(suggested, header=None)
        preview = {
            "name": suggested,
            "total_rows": int(full_df.shape[0]),
            "rows": _df_to_preview_rows(preview_df),
        }
        return {
            "format": "xlsx",
            "sheets": sheets,
            "suggested_sheet": suggested,
            "preview": preview,
        }

    # ------------------------------------------------------------------ #
    # Atomic import                                                      #
    # ------------------------------------------------------------------ #

    def import_dataset(
        self,
        project_id: int,
        file_bytes: bytes,
        filename: str,
        mappings: dict,
        user_id: int,
    ) -> dict:
        """Replace questions + applications atomically from one upload."""
        self._require_setup_state(project_id)
        self._validate_size(file_bytes)

        sheet_name = mappings.get("sheet_name")
        question_row_index = mappings.get("question_row_index")
        data_start_row_index = mappings.get("data_start_row_index")
        column_mappings = mappings.get("column_mappings") or []

        if question_row_index is None:
            raise ImportError("question_row_index is required")
        if data_start_row_index is None:
            data_start_row_index = question_row_index + 1
        if data_start_row_index <= question_row_index:
            raise ImportError(
                "data_start_row_index must come after question_row_index"
            )
        if not column_mappings:
            raise ImportError("column_mappings is required")

        # Validate roles
        for cm in column_mappings:
            role = cm.get("role")
            if role not in VALID_ROLES:
                raise ImportError(
                    f"Invalid role '{role}' (must be one of {sorted(VALID_ROLES)})"
                )

        # ID column is required (per agreed spec).
        id_columns = [cm for cm in column_mappings if cm["role"] == "id"]
        if len(id_columns) == 0:
            raise ImportError("Exactly one column must be tagged 'id'")
        if len(id_columns) > 1:
            raise ImportError("Only one column can be tagged 'id'")

        # Load the chosen sheet (or CSV), header=None so row indices match.
        fmt = _detect_format(filename)
        if fmt == "csv":
            df = _read_csv(file_bytes, header=None)
        else:
            xlsx = _open_xlsx(file_bytes)
            if not sheet_name:
                raise ImportError("sheet_name is required for XLSX uploads")
            if sheet_name not in xlsx.sheet_names:
                raise ImportError(
                    f"Sheet '{sheet_name}' not found "
                    f"(available: {xlsx.sheet_names})"
                )
            df = xlsx.parse(sheet_name, header=None)

        # Validate row indices
        if question_row_index < 0 or question_row_index >= len(df):
            raise ImportError(
                f"question_row_index {question_row_index} is out of range "
                f"(sheet has {len(df)} rows)"
            )
        if data_start_row_index >= len(df):
            raise ImportError(
                f"data_start_row_index {data_start_row_index} leaves no data rows "
                f"(sheet has {len(df)} rows)"
            )

        # Validate column indices
        n_cols = df.shape[1]
        for cm in column_mappings:
            if cm["column_index"] < 0 or cm["column_index"] >= n_cols:
                raise ImportError(
                    f"column_index {cm['column_index']} is out of range "
                    f"(sheet has {n_cols} columns)"
                )

        # Row + column count guards
        data_rows = df.iloc[data_start_row_index:]
        if len(data_rows) > MAX_ROWS:
            raise ImportError(
                f"Dataset has {len(data_rows)} rows, exceeds limit of {MAX_ROWS}"
            )
        if n_cols > MAX_COLUMNS:
            raise ImportError(
                f"Dataset has {n_cols} columns, exceeds limit of {MAX_COLUMNS}"
            )

        # Build questions: one per column tagged question/demographic/metadata
        question_columns = [
            cm for cm in column_mappings
            if cm["role"] in ("question", "demographic", "metadata")
        ]
        questions: list[Question] = []
        question_keys: list[str] = []   # parallel to question_columns by index
        for i, cm in enumerate(question_columns):
            text = _stringify(df.iat[question_row_index, cm["column_index"]])
            if not text:
                raise ImportError(
                    f"Column {cm['column_index']} has empty question text "
                    f"at row {question_row_index}"
                )
            key = f"q{i + 1}"
            questions.append(Question(
                project_id=project_id,
                key=key,
                text=text,
                type=cm["role"],
                sort_order=i,
            ))
            question_keys.append(key)

        if not questions:
            raise ImportError(
                "No question/demographic/metadata columns mapped — at least one is required"
            )

        # Build applications
        id_col = id_columns[0]["column_index"]
        applications: list[Application] = []
        seen_ids: set[str] = set()
        for row_idx in range(data_start_row_index, len(df)):
            row = df.iloc[row_idx]
            external_id = _stringify(row.iat[id_col])
            if not external_id:
                continue   # skip blank rows
            if external_id in seen_ids:
                raise ImportError(
                    f"Duplicate ID '{external_id}' at data row "
                    f"{row_idx - data_start_row_index} — IDs must be unique"
                )
            seen_ids.add(external_id)

            answers: dict[str, str] = {}
            for q_idx, cm in enumerate(question_columns):
                cell = _stringify(row.iat[cm["column_index"]])
                if cell:
                    answers[question_keys[q_idx]] = cell

            applications.append(Application(
                project_id=project_id,
                external_id=external_id,
                answers_json=json.dumps(answers, ensure_ascii=False),
                metadata_json=json.dumps({
                    "source_filename": filename,
                    "source_sheet": sheet_name if fmt == "xlsx" else "(csv)",
                    "source_row_index": row_idx,
                }, ensure_ascii=False),
            ))

        if not applications:
            raise ImportError("No data rows after the header row")

        # Atomic replace: questions then applications. CASCADE on questions
        # doesn't reach answers_json (those are JSON strings), so we just need
        # to wipe applications too. Both repos do their work inside transactions.
        self.question_repo.replace_all(project_id, questions)
        # Replace applications: delete old rows, then bulk-insert new.
        from database import get_db_cursor
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM applications WHERE project_id = ?", (project_id,))
        self.app_repo.bulk_create(applications)

        self.audit.log("project", project_id, "dataset_imported", user_id=user_id, details={
            "questions_created": len(questions),
            "applications_created": len(applications),
            "filename": filename,
            "format": fmt,
            "sheet": sheet_name if fmt == "xlsx" else None,
        })
        logger.info(
            "Imported dataset for project %d: %d questions, %d apps from %s",
            project_id, len(questions), len(applications), filename,
        )
        return {
            "questions_created": len(questions),
            "applications_created": len(applications),
        }

    # ------------------------------------------------------------------ #
    # Internals                                                          #
    # ------------------------------------------------------------------ #

    def _require_setup_state(self, project_id: int) -> None:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ImportError(f"Project {project_id} not found")
        if project.state != "setup":
            raise ImportError(
                f"Dataset import is only allowed in 'setup' state "
                f"(current: '{project.state}'). Clone the project to start over."
            )

    def _validate_size(self, file_bytes: bytes) -> None:
        if len(file_bytes) > MAX_FILE_BYTES:
            raise ImportError(
                f"File too large ({len(file_bytes)} bytes); max is {MAX_FILE_BYTES}"
            )


# ============================================================
# Pandas glue (kept module-level so it's easy to swap or test)
# ============================================================


def _detect_format(filename: str) -> str:
    """Infer 'csv' or 'xlsx' from filename. Anything else → ImportError."""
    name = filename.lower()
    if name.endswith(".csv"):
        return "csv"
    if name.endswith(".xlsx") or name.endswith(".xls"):
        return "xlsx"
    raise ImportError(f"Unsupported file type: {filename} (expected .csv or .xlsx)")


def _read_csv(file_bytes: bytes, **kwargs) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(file_bytes), dtype=str, keep_default_na=False, **kwargs)


def _count_csv_rows(file_bytes: bytes) -> int:
    df = pd.read_csv(io.BytesIO(file_bytes), dtype=str, keep_default_na=False, header=None)
    return int(df.shape[0])


def _open_xlsx(file_bytes: bytes) -> pd.ExcelFile:
    return pd.ExcelFile(io.BytesIO(file_bytes), engine="openpyxl")


def _stringify(cell: Any) -> str:
    """Cells from pandas can be NaN, numbers, etc. Normalize to a stripped string."""
    if cell is None:
        return ""
    if isinstance(cell, float) and pd.isna(cell):
        return ""
    return str(cell).strip()


def _df_to_preview_rows(df: pd.DataFrame) -> list[list[str | None]]:
    rows: list[list[str | None]] = []
    for _, row in df.iterrows():
        out: list[str | None] = []
        for v in row.values:
            s = _stringify(v)
            out.append(s if s else None)
        rows.append(out)
    return rows
