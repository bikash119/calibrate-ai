"""SQLite data access layer.

One dataclass + one Repository per table. Repositories are stateless: they
hold no connection or path state, every method goes through `get_db_cursor()`.

Derived data (medians, comparisons, counts, agreement summaries) does NOT
live here — that belongs in `api/services/*`. Repositories return raw rows.
"""

from dataclasses import dataclass, field
from typing import Any

from database import get_db_cursor


# ============================================================
# Identity
# ============================================================


@dataclass
class User:
    id: int | None = None
    username: str = ""
    password_hash: str = ""
    display_name: str | None = None
    role: str = "user"          # 'admin' | 'user'
    created_at: str | None = None
    updated_at: str | None = None


class UserRepository:
    """Data access for the users table."""

    def get_by_id(self, user_id: int) -> User | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            return User(**dict(row)) if row else None

    def get_by_username(self, username: str) -> User | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
            row = cursor.fetchone()
            return User(**dict(row)) if row else None

    def get_all(self) -> list[User]:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM users ORDER BY created_at DESC")
            return [User(**dict(row)) for row in cursor.fetchall()]

    def create(self, user: User) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO users (username, password_hash, display_name, role)
                   VALUES (?, ?, ?, ?)""",
                (user.username, user.password_hash, user.display_name, user.role),
            )
            return cursor.lastrowid

    def update_password(self, user_id: int, password_hash: str) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (password_hash, user_id),
            )

    def delete(self, user_id: int) -> bool:
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
            return cursor.rowcount > 0


@dataclass
class AuditLogEntry:
    id: int | None = None
    user_id: int | None = None
    entity_type: str = ""        # 'project' | 'iteration' | 'locked_prompt' | …
    entity_id: int | None = None
    action: str = ""
    details_json: str | None = None
    created_at: str | None = None


class AuditLogRepository:
    """Append-only audit log. Generic via (entity_type, entity_id)."""

    def log(
        self,
        entity_type: str,
        entity_id: int | None,
        action: str,
        user_id: int | None = None,
        details: dict | None = None,
    ) -> int:
        import json
        details_json = json.dumps(details) if details is not None else None
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO audit_log (user_id, entity_type, entity_id, action, details_json)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, entity_type, entity_id, action, details_json),
            )
            return cursor.lastrowid

    def get_by_entity(self, entity_type: str, entity_id: int) -> list[AuditLogEntry]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM audit_log
                   WHERE entity_type = ? AND entity_id = ?
                   ORDER BY created_at DESC""",
                (entity_type, entity_id),
            )
            return [AuditLogEntry(**dict(row)) for row in cursor.fetchall()]

    def get_recent(self, limit: int = 100) -> list[AuditLogEntry]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
            return [AuditLogEntry(**dict(row)) for row in cursor.fetchall()]


# ============================================================
# Org: programs and projects
# ============================================================


@dataclass
class Program:
    id: int | None = None
    name: str = ""
    description: str | None = None
    created_by: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProgramRepository:
    """Data access for the programs table."""

    def get_by_id(self, program_id: int) -> Program | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM programs WHERE id = ?", (program_id,))
            row = cursor.fetchone()
            return Program(**dict(row)) if row else None

    def get_by_name(self, name: str) -> Program | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM programs WHERE name = ?", (name,))
            row = cursor.fetchone()
            return Program(**dict(row)) if row else None

    def get_all(self) -> list[Program]:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM programs ORDER BY created_at DESC")
            return [Program(**dict(row)) for row in cursor.fetchall()]

    def create(self, program: Program) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO programs (name, description, created_by)
                   VALUES (?, ?, ?)""",
                (program.name, program.description, program.created_by),
            )
            return cursor.lastrowid

    def update(self, program_id: int, name: str, description: str | None) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """UPDATE programs SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (name, description, program_id),
            )

    def delete(self, program_id: int) -> bool:
        """Delete a program. Will fail if any project references it (ON DELETE RESTRICT)."""
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM programs WHERE id = ?", (program_id,))
            return cursor.rowcount > 0


@dataclass
class Project:
    id: int | None = None
    program_id: int = 0
    name: str = ""
    description: str | None = None
    language: str | None = None
    state: str = "setup"
    random_seed: int = 0
    cloned_from_id: int | None = None
    created_by: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProjectRepository:
    """Data access for the projects table."""

    def get_by_id(self, project_id: int) -> Project | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            row = cursor.fetchone()
            return Project(**dict(row)) if row else None

    def get_all(
        self, program_id: int | None = None, state: str | None = None
    ) -> list[Project]:
        clauses: list[str] = []
        params: list[Any] = []
        if program_id is not None:
            clauses.append("program_id = ?")
            params.append(program_id)
        if state is not None:
            clauses.append("state = ?")
            params.append(state)
        where = (" WHERE " + " AND ".join(clauses)) if clauses else ""
        with get_db_cursor() as cursor:
            cursor.execute(
                f"SELECT * FROM projects{where} ORDER BY updated_at DESC",
                params,
            )
            return [Project(**dict(row)) for row in cursor.fetchall()]

    def create(self, project: Project) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO projects
                   (program_id, name, description, language, state, random_seed,
                    cloned_from_id, created_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    project.program_id, project.name, project.description,
                    project.language, project.state, project.random_seed,
                    project.cloned_from_id, project.created_by,
                ),
            )
            return cursor.lastrowid

    def update_state(self, project_id: int, new_state: str) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """UPDATE projects SET state = ?, updated_at = CURRENT_TIMESTAMP
                   WHERE id = ?""",
                (new_state, project_id),
            )

    def update_metadata(
        self,
        project_id: int,
        name: str | None = None,
        description: str | None = None,
        language: str | None = None,
    ) -> None:
        sets: list[str] = []
        params: list[Any] = []
        if name is not None:
            sets.append("name = ?")
            params.append(name)
        if description is not None:
            sets.append("description = ?")
            params.append(description)
        if language is not None:
            sets.append("language = ?")
            params.append(language)
        if not sets:
            return
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(project_id)
        with get_db_cursor() as cursor:
            cursor.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", params)

    def delete(self, project_id: int) -> bool:
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            return cursor.rowcount > 0

    def count_by_state(self, program_id: int | None = None) -> dict[str, int]:
        with get_db_cursor() as cursor:
            if program_id is not None:
                cursor.execute(
                    "SELECT state, COUNT(*) AS cnt FROM projects WHERE program_id = ? GROUP BY state",
                    (program_id,),
                )
            else:
                cursor.execute("SELECT state, COUNT(*) AS cnt FROM projects GROUP BY state")
            return {row["state"]: row["cnt"] for row in cursor.fetchall()}


# ============================================================
# Rubric
# ============================================================


@dataclass
class Criterion:
    id: int | None = None
    project_id: int = 0
    name: str = ""
    description: str = ""
    scale_min: int = 1
    scale_max: int = 3
    anchor_descriptions_json: str = "{}"
    feeding_question_keys_json: str = "[]"
    weighted_question_keys_json: str = "[]"
    sort_order: int = 0


class CriteriaRepository:
    """Data access for the criteria table (project rubric)."""

    def get_by_id(self, criterion_id: int) -> Criterion | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM criteria WHERE id = ?", (criterion_id,))
            row = cursor.fetchone()
            return Criterion(**dict(row)) if row else None

    def get_by_project(self, project_id: int) -> list[Criterion]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM criteria WHERE project_id = ? ORDER BY sort_order, id",
                (project_id,),
            )
            return [Criterion(**dict(row)) for row in cursor.fetchall()]

    def get_by_name(self, project_id: int, name: str) -> Criterion | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM criteria WHERE project_id = ? AND name = ?",
                (project_id, name),
            )
            row = cursor.fetchone()
            return Criterion(**dict(row)) if row else None

    def create(self, criterion: Criterion) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO criteria
                   (project_id, name, description, scale_min, scale_max,
                    anchor_descriptions_json, feeding_question_keys_json,
                    weighted_question_keys_json, sort_order)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    criterion.project_id, criterion.name, criterion.description,
                    criterion.scale_min, criterion.scale_max,
                    criterion.anchor_descriptions_json,
                    criterion.feeding_question_keys_json,
                    criterion.weighted_question_keys_json,
                    criterion.sort_order,
                ),
            )
            return cursor.lastrowid

    def replace_all(self, project_id: int, criteria: list[Criterion]) -> None:
        """Atomic replacement of all criteria for a project."""
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM criteria WHERE project_id = ?", (project_id,))
            for c in criteria:
                cursor.execute(
                    """INSERT INTO criteria
                       (project_id, name, description, scale_min, scale_max,
                        anchor_descriptions_json, feeding_question_keys_json,
                        weighted_question_keys_json, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        project_id, c.name, c.description, c.scale_min, c.scale_max,
                        c.anchor_descriptions_json, c.feeding_question_keys_json,
                        c.weighted_question_keys_json, c.sort_order,
                    ),
                )

    def delete(self, criterion_id: int) -> bool:
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM criteria WHERE id = ?", (criterion_id,))
            return cursor.rowcount > 0


# ============================================================
# Dataset
# ============================================================


@dataclass
class Question:
    id: int | None = None
    project_id: int = 0
    key: str = ""
    text: str = ""
    sort_order: int = 0


class QuestionRepository:
    """Data access for the questions table (project dataset schema)."""

    def get_by_id(self, question_id: int) -> Question | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM questions WHERE id = ?", (question_id,))
            row = cursor.fetchone()
            return Question(**dict(row)) if row else None

    def get_by_project(self, project_id: int) -> list[Question]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM questions WHERE project_id = ? ORDER BY sort_order, id",
                (project_id,),
            )
            return [Question(**dict(row)) for row in cursor.fetchall()]

    def get_by_key(self, project_id: int, key: str) -> Question | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM questions WHERE project_id = ? AND key = ?",
                (project_id, key),
            )
            row = cursor.fetchone()
            return Question(**dict(row)) if row else None

    def create(self, question: Question) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO questions (project_id, key, text, sort_order)
                   VALUES (?, ?, ?, ?)""",
                (question.project_id, question.key, question.text, question.sort_order),
            )
            return cursor.lastrowid

    def replace_all(self, project_id: int, questions: list[Question]) -> None:
        """Atomic replacement of all questions for a project."""
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM questions WHERE project_id = ?", (project_id,))
            for q in questions:
                cursor.execute(
                    """INSERT INTO questions (project_id, key, text, sort_order)
                       VALUES (?, ?, ?, ?)""",
                    (project_id, q.key, q.text, q.sort_order),
                )


@dataclass
class Application:
    id: int | None = None
    project_id: int = 0
    external_id: str = ""
    answers_json: str = "{}"
    metadata_json: str | None = None
    created_at: str | None = None


class ApplicationRepository:
    """Data access for the applications table."""

    def get_by_id(self, application_id: int) -> Application | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM applications WHERE id = ?", (application_id,))
            row = cursor.fetchone()
            return Application(**dict(row)) if row else None

    def get_by_project(self, project_id: int) -> list[Application]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM applications WHERE project_id = ? ORDER BY id",
                (project_id,),
            )
            return [Application(**dict(row)) for row in cursor.fetchall()]

    def get_ids_by_project(self, project_id: int) -> list[int]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT id FROM applications WHERE project_id = ? ORDER BY id",
                (project_id,),
            )
            return [row["id"] for row in cursor.fetchall()]

    def get_by_external_id(self, project_id: int, external_id: str) -> Application | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM applications WHERE project_id = ? AND external_id = ?",
                (project_id, external_id),
            )
            row = cursor.fetchone()
            return Application(**dict(row)) if row else None

    def create(self, application: Application) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO applications (project_id, external_id, answers_json, metadata_json)
                   VALUES (?, ?, ?, ?)""",
                (
                    application.project_id, application.external_id,
                    application.answers_json, application.metadata_json,
                ),
            )
            return cursor.lastrowid

    def bulk_create(self, applications: list[Application]) -> list[int]:
        ids: list[int] = []
        with get_db_cursor() as cursor:
            for app in applications:
                cursor.execute(
                    """INSERT INTO applications (project_id, external_id, answers_json, metadata_json)
                       VALUES (?, ?, ?, ?)""",
                    (app.project_id, app.external_id, app.answers_json, app.metadata_json),
                )
                ids.append(cursor.lastrowid)
        return ids

    def count_by_project(self, project_id: int) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT COUNT(*) AS cnt FROM applications WHERE project_id = ?",
                (project_id,),
            )
            return cursor.fetchone()["cnt"]


@dataclass
class HumanScore:
    id: int | None = None
    application_id: int = 0
    criterion_id: int = 0
    evaluator_id: str = ""        # TEXT — supports external evaluator IDs
    score: int = 0
    created_at: str | None = None


class HumanScoreRepository:
    """Data access for the human_scores table.

    NB: medians and comparisons are NOT here. They live in the statistics service.
    """

    def get_by_id(self, score_id: int) -> HumanScore | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM human_scores WHERE id = ?", (score_id,))
            row = cursor.fetchone()
            return HumanScore(**dict(row)) if row else None

    def get_for_application(self, application_id: int) -> list[HumanScore]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM human_scores WHERE application_id = ?",
                (application_id,),
            )
            return [HumanScore(**dict(row)) for row in cursor.fetchall()]

    def get_for_application_criterion(
        self, application_id: int, criterion_id: int
    ) -> list[HumanScore]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM human_scores
                   WHERE application_id = ? AND criterion_id = ?""",
                (application_id, criterion_id),
            )
            return [HumanScore(**dict(row)) for row in cursor.fetchall()]

    def get_for_project(self, project_id: int) -> list[HumanScore]:
        """All human scores for a project, joined via applications."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT hs.* FROM human_scores hs
                   JOIN applications a ON a.id = hs.application_id
                   WHERE a.project_id = ?""",
                (project_id,),
            )
            return [HumanScore(**dict(row)) for row in cursor.fetchall()]

    def get_evaluator_ids_for_project(self, project_id: int) -> list[str]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT DISTINCT hs.evaluator_id FROM human_scores hs
                   JOIN applications a ON a.id = hs.application_id
                   WHERE a.project_id = ? ORDER BY hs.evaluator_id""",
                (project_id,),
            )
            return [row["evaluator_id"] for row in cursor.fetchall()]

    def create(self, score: HumanScore) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO human_scores (application_id, criterion_id, evaluator_id, score)
                   VALUES (?, ?, ?, ?)""",
                (score.application_id, score.criterion_id, score.evaluator_id, score.score),
            )
            return cursor.lastrowid

    def bulk_create(self, scores: list[HumanScore]) -> int:
        with get_db_cursor() as cursor:
            cursor.executemany(
                """INSERT INTO human_scores (application_id, criterion_id, evaluator_id, score)
                   VALUES (?, ?, ?, ?)""",
                [
                    (s.application_id, s.criterion_id, s.evaluator_id, s.score)
                    for s in scores
                ],
            )
            return cursor.rowcount


# ============================================================
# Splits
# ============================================================


@dataclass
class Split:
    project_id: int = 0
    application_id: int = 0
    split: str = ""               # 'dev' | 'validation' | 'test'


class SplitRepository:
    """Data access for the splits table."""

    def get_by_project(self, project_id: int) -> list[Split]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM splits WHERE project_id = ?",
                (project_id,),
            )
            return [Split(**dict(row)) for row in cursor.fetchall()]

    def get_application_ids(self, project_id: int, split: str) -> list[int]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT application_id FROM splits
                   WHERE project_id = ? AND split = ?
                   ORDER BY application_id""",
                (project_id, split),
            )
            return [row["application_id"] for row in cursor.fetchall()]

    def count_by_split(self, project_id: int) -> dict[str, int]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT split, COUNT(*) AS cnt FROM splits
                   WHERE project_id = ? GROUP BY split""",
                (project_id,),
            )
            return {row["split"]: row["cnt"] for row in cursor.fetchall()}

    def replace_all(self, project_id: int, splits: list[Split]) -> None:
        """Atomic replacement of all splits for a project (used when re-generating)."""
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM splits WHERE project_id = ?", (project_id,))
            cursor.executemany(
                "INSERT INTO splits (project_id, application_id, split) VALUES (?, ?, ?)",
                [(s.project_id, s.application_id, s.split) for s in splits],
            )


# ============================================================
# Iteration loop
# ============================================================


@dataclass
class Iteration:
    id: int | None = None
    project_id: int = 0
    version: int = 1
    note: str | None = None
    created_by: int | None = None
    created_at: str | None = None


class IterationRepository:
    """Data access for the iterations table."""

    def get_by_id(self, iteration_id: int) -> Iteration | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM iterations WHERE id = ?", (iteration_id,))
            row = cursor.fetchone()
            return Iteration(**dict(row)) if row else None

    def get_by_project(self, project_id: int) -> list[Iteration]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM iterations
                   WHERE project_id = ? ORDER BY version""",
                (project_id,),
            )
            return [Iteration(**dict(row)) for row in cursor.fetchall()]

    def get_latest(self, project_id: int) -> Iteration | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM iterations
                   WHERE project_id = ? ORDER BY version DESC LIMIT 1""",
                (project_id,),
            )
            row = cursor.fetchone()
            return Iteration(**dict(row)) if row else None

    def next_version(self, project_id: int) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT MAX(version) AS v FROM iterations WHERE project_id = ?",
                (project_id,),
            )
            row = cursor.fetchone()
            return (row["v"] or 0) + 1

    def create(self, iteration: Iteration) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO iterations (project_id, version, note, created_by)
                   VALUES (?, ?, ?, ?)""",
                (iteration.project_id, iteration.version, iteration.note, iteration.created_by),
            )
            return cursor.lastrowid


@dataclass
class IterationPrompt:
    iteration_id: int = 0
    criterion_id: int = 0
    system_prompt: str = ""


class IterationPromptRepository:
    """Per-criterion system prompts within an iteration."""

    def get_by_iteration(self, iteration_id: int) -> list[IterationPrompt]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM iteration_prompts WHERE iteration_id = ?",
                (iteration_id,),
            )
            return [IterationPrompt(**dict(row)) for row in cursor.fetchall()]

    def get_as_dict(self, iteration_id: int) -> dict[int, str]:
        """Returns {criterion_id: system_prompt}."""
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT criterion_id, system_prompt FROM iteration_prompts WHERE iteration_id = ?",
                (iteration_id,),
            )
            return {row["criterion_id"]: row["system_prompt"] for row in cursor.fetchall()}

    def get_for_criterion(self, iteration_id: int, criterion_id: int) -> str | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT system_prompt FROM iteration_prompts
                   WHERE iteration_id = ? AND criterion_id = ?""",
                (iteration_id, criterion_id),
            )
            row = cursor.fetchone()
            return row["system_prompt"] if row else None

    def upsert(self, iteration_id: int, criterion_id: int, system_prompt: str) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO iteration_prompts (iteration_id, criterion_id, system_prompt)
                   VALUES (?, ?, ?)
                   ON CONFLICT(iteration_id, criterion_id) DO UPDATE SET
                       system_prompt = excluded.system_prompt""",
                (iteration_id, criterion_id, system_prompt),
            )

    def bulk_upsert(self, prompts: list[IterationPrompt]) -> None:
        with get_db_cursor() as cursor:
            cursor.executemany(
                """INSERT INTO iteration_prompts (iteration_id, criterion_id, system_prompt)
                   VALUES (?, ?, ?)
                   ON CONFLICT(iteration_id, criterion_id) DO UPDATE SET
                       system_prompt = excluded.system_prompt""",
                [(p.iteration_id, p.criterion_id, p.system_prompt) for p in prompts],
            )


# ============================================================
# Scoring
# ============================================================


@dataclass
class ScoringJob:
    id: int | None = None
    project_id: int = 0
    iteration_id: int = 0
    split: str = ""               # 'dev' | 'validation' | 'test' | 'production'
    status: str = "pending"
    progress_total: int = 0
    progress_current: int = 0
    provider: str = ""
    model: str = ""
    batch_external_id: str | None = None
    cost_estimate_usd: float | None = None
    cost_actual_usd: float | None = None
    error_message: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


class ScoringJobRepository:
    """Data access for the scoring_jobs table."""

    def get_by_id(self, job_id: int) -> ScoringJob | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM scoring_jobs WHERE id = ?", (job_id,))
            row = cursor.fetchone()
            return ScoringJob(**dict(row)) if row else None

    def get_by_project(
        self, project_id: int, status: str | None = None
    ) -> list[ScoringJob]:
        with get_db_cursor() as cursor:
            if status:
                cursor.execute(
                    """SELECT * FROM scoring_jobs
                       WHERE project_id = ? AND status = ?
                       ORDER BY created_at DESC""",
                    (project_id, status),
                )
            else:
                cursor.execute(
                    """SELECT * FROM scoring_jobs
                       WHERE project_id = ? ORDER BY created_at DESC""",
                    (project_id,),
                )
            return [ScoringJob(**dict(row)) for row in cursor.fetchall()]

    def get_by_iteration(self, iteration_id: int) -> list[ScoringJob]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM scoring_jobs
                   WHERE iteration_id = ? ORDER BY created_at DESC""",
                (iteration_id,),
            )
            return [ScoringJob(**dict(row)) for row in cursor.fetchall()]

    def get_by_batch_external_id(self, batch_external_id: str) -> ScoringJob | None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM scoring_jobs WHERE batch_external_id = ?",
                (batch_external_id,),
            )
            row = cursor.fetchone()
            return ScoringJob(**dict(row)) if row else None

    def create(self, job: ScoringJob) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO scoring_jobs
                   (project_id, iteration_id, split, status, progress_total,
                    provider, model, batch_external_id, cost_estimate_usd)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    job.project_id, job.iteration_id, job.split, job.status,
                    job.progress_total, job.provider, job.model,
                    job.batch_external_id, job.cost_estimate_usd,
                ),
            )
            return cursor.lastrowid

    def update_status(
        self,
        job_id: int,
        status: str,
        error_message: str | None = None,
    ) -> None:
        timestamps_clause = ""
        if status == "running":
            timestamps_clause = ", started_at = CURRENT_TIMESTAMP"
        elif status in ("completed", "failed", "cancelled"):
            timestamps_clause = ", completed_at = CURRENT_TIMESTAMP"
        with get_db_cursor() as cursor:
            cursor.execute(
                f"""UPDATE scoring_jobs
                    SET status = ?, error_message = ?{timestamps_clause}
                    WHERE id = ?""",
                (status, error_message, job_id),
            )

    def update_progress(self, job_id: int, current: int) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE scoring_jobs SET progress_current = ? WHERE id = ?",
                (current, job_id),
            )

    def update_cost_actual(self, job_id: int, cost_usd: float) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE scoring_jobs SET cost_actual_usd = ? WHERE id = ?",
                (cost_usd, job_id),
            )


@dataclass
class LlmScore:
    job_id: int = 0
    application_id: int = 0
    criterion_id: int = 0
    score: int = 0
    reasoning: str | None = None
    raw_response: str | None = None
    created_at: str | None = None


class LlmScoreRepository:
    """Data access for the llm_scores table.

    NB: comparison/agreement against humans is NOT computed here — see statistics service.
    """

    def get_for_job(self, job_id: int) -> list[LlmScore]:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM llm_scores WHERE job_id = ?", (job_id,))
            return [LlmScore(**dict(row)) for row in cursor.fetchall()]

    def get_for_application_criterion(
        self, application_id: int, criterion_id: int, limit: int = 10
    ) -> list[LlmScore]:
        """Most recent LLM scores for an (app, criterion) pair across jobs."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM llm_scores
                   WHERE application_id = ? AND criterion_id = ?
                   ORDER BY created_at DESC LIMIT ?""",
                (application_id, criterion_id, limit),
            )
            return [LlmScore(**dict(row)) for row in cursor.fetchall()]

    def create(self, score: LlmScore) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO llm_scores
                   (job_id, application_id, criterion_id, score, reasoning, raw_response)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    score.job_id, score.application_id, score.criterion_id,
                    score.score, score.reasoning, score.raw_response,
                ),
            )

    def bulk_create(self, scores: list[LlmScore]) -> int:
        with get_db_cursor() as cursor:
            cursor.executemany(
                """INSERT INTO llm_scores
                   (job_id, application_id, criterion_id, score, reasoning, raw_response)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [
                    (s.job_id, s.application_id, s.criterion_id, s.score, s.reasoning, s.raw_response)
                    for s in scores
                ],
            )
            return cursor.rowcount


# ============================================================
# Analysis
# ============================================================


@dataclass
class AgreementMetric:
    id: int | None = None
    project_id: int = 0
    iteration_id: int | None = None      # NULL for H-H baseline
    split: str = "dev"
    criterion_id: int | None = None      # NULL for project-overall
    metric: str = ""                     # 'qwk' | 'exact' | 'within_1' | 'krippendorff' | 'spearman' | …
    value: float | None = None
    ci_low: float | None = None
    ci_high: float | None = None
    n: int | None = None
    computed_at: str | None = None


class AgreementMetricRepository:
    """Generic agreement metrics — covers H-H baseline AND LLM-H per iteration."""

    def get_for_project(
        self,
        project_id: int,
        iteration_id: int | None = ...,    # type: ignore[assignment]
        split: str | None = None,
        criterion_id: int | None = ...,    # type: ignore[assignment]
        metric: str | None = None,
    ) -> list[AgreementMetric]:
        """Filter metrics. Use `None` for "exactly NULL"; omit for "any value"."""
        clauses: list[str] = ["project_id = ?"]
        params: list[Any] = [project_id]

        if iteration_id is not Ellipsis:
            if iteration_id is None:
                clauses.append("iteration_id IS NULL")
            else:
                clauses.append("iteration_id = ?")
                params.append(iteration_id)
        if split is not None:
            clauses.append("split = ?")
            params.append(split)
        if criterion_id is not Ellipsis:
            if criterion_id is None:
                clauses.append("criterion_id IS NULL")
            else:
                clauses.append("criterion_id = ?")
                params.append(criterion_id)
        if metric is not None:
            clauses.append("metric = ?")
            params.append(metric)

        with get_db_cursor() as cursor:
            cursor.execute(
                f"""SELECT * FROM agreement_metrics
                    WHERE {' AND '.join(clauses)}
                    ORDER BY computed_at DESC""",
                params,
            )
            return [AgreementMetric(**dict(row)) for row in cursor.fetchall()]

    def upsert(self, m: AgreementMetric) -> None:
        """Upsert one metric row keyed by (project, iteration, split, criterion, metric)."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO agreement_metrics
                   (project_id, iteration_id, split, criterion_id, metric,
                    value, ci_low, ci_high, n)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(project_id, iteration_id, split, criterion_id, metric)
                   DO UPDATE SET
                       value = excluded.value,
                       ci_low = excluded.ci_low,
                       ci_high = excluded.ci_high,
                       n = excluded.n,
                       computed_at = CURRENT_TIMESTAMP""",
                (
                    m.project_id, m.iteration_id, m.split, m.criterion_id, m.metric,
                    m.value, m.ci_low, m.ci_high, m.n,
                ),
            )

    def bulk_upsert(self, metrics: list[AgreementMetric]) -> None:
        for m in metrics:
            self.upsert(m)


@dataclass
class DisagreementFlag:
    id: int | None = None
    project_id: int = 0
    application_id: int = 0
    criterion_id: int = 0
    flag: str = ""                # 'llm_correct' | 'human_correct' | 'ambiguous'
    flagged_by: int | None = None
    created_at: str | None = None


class DisagreementFlagRepository:
    """Operator flags on (app, criterion) — one flag per (project, app, criterion)."""

    def get_for_project(self, project_id: int) -> list[DisagreementFlag]:
        with get_db_cursor() as cursor:
            cursor.execute(
                "SELECT * FROM disagreement_flags WHERE project_id = ?",
                (project_id,),
            )
            return [DisagreementFlag(**dict(row)) for row in cursor.fetchall()]

    def get_for_application(
        self, project_id: int, application_id: int
    ) -> list[DisagreementFlag]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM disagreement_flags
                   WHERE project_id = ? AND application_id = ?""",
                (project_id, application_id),
            )
            return [DisagreementFlag(**dict(row)) for row in cursor.fetchall()]

    def upsert(self, f: DisagreementFlag) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO disagreement_flags
                   (project_id, application_id, criterion_id, flag, flagged_by)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(project_id, application_id, criterion_id)
                   DO UPDATE SET
                       flag = excluded.flag,
                       flagged_by = excluded.flagged_by,
                       created_at = CURRENT_TIMESTAMP""",
                (f.project_id, f.application_id, f.criterion_id, f.flag, f.flagged_by),
            )

    def count_by_flag(self, project_id: int) -> dict[str, int]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT flag, COUNT(*) AS cnt FROM disagreement_flags
                   WHERE project_id = ? GROUP BY flag""",
                (project_id,),
            )
            return {row["flag"]: row["cnt"] for row in cursor.fetchall()}

    def delete(self, flag_id: int) -> bool:
        with get_db_cursor() as cursor:
            cursor.execute("DELETE FROM disagreement_flags WHERE id = ?", (flag_id,))
            return cursor.rowcount > 0


@dataclass
class CalibrationExample:
    id: int | None = None
    project_id: int = 0
    criterion_id: int = 0
    application_id: int = 0
    human_score: int = 0
    synthesized_reasoning: str = ""
    condensed_answers_json: str = "[]"
    source: str = "auto"          # 'operator_flagged' | 'evaluator_consensus' | 'auto' | 'manual'
    is_active: int = 1
    sort_order: int = 0
    created_at: str | None = None


class CalibrationExampleRepository:
    """Few-shot calibration examples per (project, criterion)."""

    def get_for_criterion(
        self, project_id: int, criterion_id: int, active_only: bool = True
    ) -> list[CalibrationExample]:
        sql = """SELECT * FROM calibration_examples
                 WHERE project_id = ? AND criterion_id = ?"""
        params: list[Any] = [project_id, criterion_id]
        if active_only:
            sql += " AND is_active = 1"
        sql += " ORDER BY sort_order, id"
        with get_db_cursor() as cursor:
            cursor.execute(sql, params)
            return [CalibrationExample(**dict(row)) for row in cursor.fetchall()]

    def get_active_as_dict(self, project_id: int) -> dict[int, list[CalibrationExample]]:
        """Returns {criterion_id: [examples]} for all active examples in a project."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM calibration_examples
                   WHERE project_id = ? AND is_active = 1
                   ORDER BY criterion_id, sort_order, id""",
                (project_id,),
            )
            result: dict[int, list[CalibrationExample]] = {}
            for row in cursor.fetchall():
                ex = CalibrationExample(**dict(row))
                result.setdefault(ex.criterion_id, []).append(ex)
            return result

    def replace_for_criterion(
        self, project_id: int, criterion_id: int, examples: list[CalibrationExample]
    ) -> None:
        """Atomic replacement of all examples for a (project, criterion)."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """DELETE FROM calibration_examples
                   WHERE project_id = ? AND criterion_id = ?""",
                (project_id, criterion_id),
            )
            for ex in examples:
                cursor.execute(
                    """INSERT INTO calibration_examples
                       (project_id, criterion_id, application_id, human_score,
                        synthesized_reasoning, condensed_answers_json, source,
                        is_active, sort_order)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        project_id, criterion_id, ex.application_id, ex.human_score,
                        ex.synthesized_reasoning, ex.condensed_answers_json, ex.source,
                        ex.is_active, ex.sort_order,
                    ),
                )

    def set_active(self, example_id: int, is_active: bool) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE calibration_examples SET is_active = ? WHERE id = ?",
                (1 if is_active else 0, example_id),
            )


# ============================================================
# Output: locked prompts (immutable artifact)
# ============================================================


@dataclass
class LockedPrompt:
    id: int | None = None
    project_id: int | None = None        # SET NULL on project delete
    iteration_id: int | None = None
    name: str = ""
    rubric_snapshot_json: str = "{}"
    prompts_snapshot_json: str = "{}"
    examples_snapshot_json: str | None = None
    prompt_hash: str = ""
    test_metrics_json: str = "{}"
    provider: str = ""
    model: str = ""
    locked_by: int | None = None
    locked_at: str | None = None


class LockedPromptRepository:
    """Data access for locked_prompts. Records are intended to be immutable."""

    def get_by_id(self, locked_id: int) -> LockedPrompt | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM locked_prompts WHERE id = ?", (locked_id,))
            row = cursor.fetchone()
            return LockedPrompt(**dict(row)) if row else None

    def get_by_project(self, project_id: int) -> list[LockedPrompt]:
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT * FROM locked_prompts
                   WHERE project_id = ? ORDER BY locked_at DESC""",
                (project_id,),
            )
            return [LockedPrompt(**dict(row)) for row in cursor.fetchall()]

    def get_all(self) -> list[LockedPrompt]:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM locked_prompts ORDER BY locked_at DESC")
            return [LockedPrompt(**dict(row)) for row in cursor.fetchall()]

    def create(self, lp: LockedPrompt) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                """INSERT INTO locked_prompts
                   (project_id, iteration_id, name, rubric_snapshot_json,
                    prompts_snapshot_json, examples_snapshot_json, prompt_hash,
                    test_metrics_json, provider, model, locked_by)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    lp.project_id, lp.iteration_id, lp.name,
                    lp.rubric_snapshot_json, lp.prompts_snapshot_json,
                    lp.examples_snapshot_json, lp.prompt_hash, lp.test_metrics_json,
                    lp.provider, lp.model, lp.locked_by,
                ),
            )
            return cursor.lastrowid
