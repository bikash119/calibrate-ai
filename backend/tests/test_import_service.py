"""Dataset import wizard: parse + atomic replace.

Stresses the moving parts:
- CSV vs XLSX format detection
- Sheet selection on multi-sheet XLSX
- Required ID column
- State-machine guard (refuse outside 'setup')
- Atomic replace semantics
- Size limits
"""

import io
import json

import pandas as pd
import pytest

from api.services.import_service import ImportError, ImportService
from db_models import (
    ApplicationRepository,
    Project,
    ProjectRepository,
    QuestionRepository,
)


# ------------------------------------------------------------------ #
# Fixture helpers                                                    #
# ------------------------------------------------------------------ #


def _make_project(seeded_db, state: str = "setup") -> int:
    """Bare-bones project for import tests."""
    repo = ProjectRepository()
    pid = repo.create(Project(
        program_id=1, name="import-test", state=state,
        random_seed=1, created_by=1,
    ))
    return pid


def _csv(rows: list[list[str]]) -> bytes:
    df = pd.DataFrame(rows)
    return df.to_csv(index=False, header=False).encode("utf-8")


def _xlsx(sheets: dict[str, list[list[str]]]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, rows in sheets.items():
            pd.DataFrame(rows).to_excel(writer, sheet_name=name, header=False, index=False)
    return buf.getvalue()


# ------------------------------------------------------------------ #
# Parse (preview)                                                    #
# ------------------------------------------------------------------ #


def test_parse_csv_returns_synthetic_sheet(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([
        ["id", "team", "market"],
        ["a1", "three engineers", "B2B SaaS"],
        ["a2", "solo founder", "consumers"],
    ])
    r = ImportService().parse(pid, csv, "data.csv")
    assert r["format"] == "csv"
    assert len(r["sheets"]) == 1
    assert r["sheets"][0]["columns"] == 3
    assert r["preview"]["total_rows"] == 3
    assert r["preview"]["rows"][0] == ["id", "team", "market"]
    assert r["preview"]["rows"][1] == ["a1", "three engineers", "B2B SaaS"]


def test_parse_xlsx_with_multiple_sheets(seeded_db):
    pid = _make_project(seeded_db)
    xlsx = _xlsx({
        "Cohort A": [
            ["id", "team"],
            ["a1", "team a"],
        ],
        "Cohort B": [
            ["id", "team"],
            ["b1", "team b"],
            ["b2", "team b2"],
        ],
    })
    r = ImportService().parse(pid, xlsx, "data.xlsx")
    assert r["format"] == "xlsx"
    sheet_names = [s["name"] for s in r["sheets"]]
    assert sheet_names == ["Cohort A", "Cohort B"]
    assert r["suggested_sheet"] == "Cohort A"   # default to first
    assert r["preview"]["total_rows"] == 2


def test_parse_refuses_unknown_format(seeded_db):
    pid = _make_project(seeded_db)
    with pytest.raises(ImportError, match="Unsupported file type"):
        ImportService().parse(pid, b"not a real file", "data.txt")


def test_parse_refuses_outside_setup_state(seeded_db):
    pid = _make_project(seeded_db, state="iterating")
    csv = _csv([["id"], ["a1"]])
    with pytest.raises(ImportError, match="setup"):
        ImportService().parse(pid, csv, "data.csv")


def test_parse_refuses_oversize_file(seeded_db):
    pid = _make_project(seeded_db)
    huge = b"x" * (11 * 1024 * 1024)
    with pytest.raises(ImportError, match="too large"):
        ImportService().parse(pid, huge, "data.csv")


# ------------------------------------------------------------------ #
# Import — happy path                                                #
# ------------------------------------------------------------------ #


def test_import_csv_basic(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([
        ["id", "team", "market", "exclude_me"],
        ["app-1", "three engineers", "B2B SaaS", "junk"],
        ["app-2", "solo founder", "consumers", "junk"],
    ])
    mappings = {
        "sheet_name": None,
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
            {"column_index": 2, "role": "question"},
            {"column_index": 3, "role": "exclude"},
        ],
    }
    result = ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)
    assert result == {"questions_created": 2, "applications_created": 2}

    # Two questions with auto-generated keys
    qs = QuestionRepository().get_by_project(pid)
    assert [q.key for q in qs] == ["q1", "q2"]
    assert [q.text for q in qs] == ["team", "market"]
    assert [q.type for q in qs] == ["question", "question"]

    # Two applications keyed by the id column
    apps = ApplicationRepository().get_by_project(pid)
    assert {a.external_id for a in apps} == {"app-1", "app-2"}

    # Answers keyed by the auto-generated question keys
    app1 = next(a for a in apps if a.external_id == "app-1")
    answers = json.loads(app1.answers_json)
    assert answers == {"q1": "three engineers", "q2": "B2B SaaS"}

    # Excluded column not stored anywhere
    assert "exclude_me" not in answers
    assert "junk" not in app1.answers_json


def test_import_tags_demographic_and_metadata(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([
        ["id", "team", "city", "website"],
        ["a1", "three engineers", "Austin", "https://example.com"],
    ])
    mappings = {
        "sheet_name": None,
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
            {"column_index": 2, "role": "demographic"},
            {"column_index": 3, "role": "metadata"},
        ],
    }
    ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)

    qs = QuestionRepository().get_by_project(pid)
    by_text = {q.text: q for q in qs}
    assert by_text["team"].type == "question"
    assert by_text["city"].type == "demographic"
    assert by_text["website"].type == "metadata"

    apps = ApplicationRepository().get_by_project(pid)
    answers = json.loads(apps[0].answers_json)
    # All three non-id columns flow into answers_json keyed by question.key
    assert set(answers.values()) == {"three engineers", "Austin", "https://example.com"}


def test_import_xlsx_with_sheet_picker(seeded_db):
    pid = _make_project(seeded_db)
    xlsx = _xlsx({
        "Cohort A": [["id", "team"], ["a1", "team a"]],
        "Cohort B": [["id", "team"], ["b1", "team b"], ["b2", "team b2"]],
    })
    mappings = {
        "sheet_name": "Cohort B",   # operator picked the second sheet
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
        ],
    }
    result = ImportService().import_dataset(pid, xlsx, "data.xlsx", mappings, user_id=1)
    assert result["applications_created"] == 2
    apps = ApplicationRepository().get_by_project(pid)
    assert {a.external_id for a in apps} == {"b1", "b2"}


def test_import_with_category_row_above_questions(seeded_db):
    """User confirms row 1 is the question row even though row 0 has categories."""
    pid = _make_project(seeded_db)
    csv = _csv([
        ["", "Team", "Team", "Market"],          # category row, ignored
        ["id", "team_size", "experience", "TAM"], # question row
        ["a1", "5", "8 yrs", "10K"],
    ])
    mappings = {
        "sheet_name": None,
        "question_row_index": 1,
        "data_start_row_index": 2,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
            {"column_index": 2, "role": "question"},
            {"column_index": 3, "role": "question"},
        ],
    }
    ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)
    qs = QuestionRepository().get_by_project(pid)
    assert [q.text for q in qs] == ["team_size", "experience", "TAM"]


# ------------------------------------------------------------------ #
# Import — validation                                                #
# ------------------------------------------------------------------ #


def test_import_refuses_outside_setup(seeded_db):
    pid = _make_project(seeded_db, state="iterating")
    csv = _csv([["id", "team"], ["a1", "x"]])
    mappings = {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
        ],
    }
    with pytest.raises(ImportError, match="setup"):
        ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)


def test_import_requires_id_column(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([["team", "market"], ["x", "y"]])
    mappings = {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "question"},
            {"column_index": 1, "role": "question"},
        ],
    }
    with pytest.raises(ImportError, match="must be tagged 'id'"):
        ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)


def test_import_refuses_two_id_columns(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([["a", "b", "team"], ["x", "y", "z"]])
    mappings = {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "id"},
            {"column_index": 2, "role": "question"},
        ],
    }
    with pytest.raises(ImportError, match="Only one column can be tagged 'id'"):
        ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)


def test_import_rejects_duplicate_ids(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([["id", "team"], ["a1", "x"], ["a1", "y"]])
    mappings = {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
        ],
    }
    with pytest.raises(ImportError, match="Duplicate ID"):
        ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)


def test_import_rejects_unknown_role(seeded_db):
    pid = _make_project(seeded_db)
    csv = _csv([["id", "team"], ["a1", "x"]])
    mappings = {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "category"},   # not in VALID_ROLES
        ],
    }
    with pytest.raises(ImportError, match="Invalid role"):
        ImportService().import_dataset(pid, csv, "data.csv", mappings, user_id=1)


def test_import_replaces_existing_questions_and_applications(seeded_db):
    """Reimport in setup state wipes prior questions+applications."""
    pid = _make_project(seeded_db)
    svc = ImportService()

    first = _csv([["id", "old"], ["a1", "x"]])
    svc.import_dataset(pid, first, "first.csv", {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
        ],
    }, user_id=1)
    assert len(QuestionRepository().get_by_project(pid)) == 1
    assert len(ApplicationRepository().get_by_project(pid)) == 1

    second = _csv([
        ["id", "new1", "new2"],
        ["b1", "p", "q"],
        ["b2", "r", "s"],
    ])
    svc.import_dataset(pid, second, "second.csv", {
        "question_row_index": 0,
        "data_start_row_index": 1,
        "column_mappings": [
            {"column_index": 0, "role": "id"},
            {"column_index": 1, "role": "question"},
            {"column_index": 2, "role": "question"},
        ],
    }, user_id=1)
    qs = QuestionRepository().get_by_project(pid)
    assert [q.text for q in qs] == ["new1", "new2"]
    apps = ApplicationRepository().get_by_project(pid)
    assert {a.external_id for a in apps} == {"b1", "b2"}
