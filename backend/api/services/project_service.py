"""Project lifecycle — create, list (with derived counts/metrics), state machine, clone, delete."""

import logging
import random

from database import get_db_cursor
from db_models import (
    Application,
    ApplicationRepository,
    AuditLogRepository,
    Criterion,
    CriteriaRepository,
    HumanScore,
    HumanScoreRepository,
    Program,
    ProgramRepository,
    Project,
    ProjectRepository,
    Question,
    QuestionRepository,
)

logger = logging.getLogger("scoring_ai.services.project")


# Project state machine — current_state -> allowed_next_states.
VALID_TRANSITIONS: dict[str, list[str]] = {
    "setup": ["baseline_computed", "abandoned"],
    "baseline_computed": ["iterating", "abandoned"],
    "iterating": ["test_run_complete", "abandoned"],
    "test_run_complete": ["locked", "abandoned"],
    "locked": ["archived"],
    "abandoned": ["archived"],
    "archived": [],
}


class ProjectService:
    """Orchestrates project lifecycle and aggregates derived view-data."""

    def __init__(self):
        self.repo = ProjectRepository()
        self.program_repo = ProgramRepository()
        self.criteria_repo = CriteriaRepository()
        self.question_repo = QuestionRepository()
        self.app_repo = ApplicationRepository()
        self.human_score_repo = HumanScoreRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------
    # Read paths — list/detail with derived counts and metrics
    # ------------------------------------------------------------------

    def list_with_derived(
        self, program_id: int | None = None, state: str | None = None
    ) -> list[dict]:
        """Return projects annotated with program_name, counts, and headline metrics."""
        projects = self.repo.get_all(program_id=program_id, state=state)
        if not projects:
            return []

        programs_by_id = {p.id: p for p in self.program_repo.get_all()}
        ids = [p.id for p in projects]
        derived = _derived_for_projects(ids)

        out: list[dict] = []
        for p in projects:
            d = derived.get(p.id, {})
            program = programs_by_id.get(p.program_id)
            out.append({
                "id": p.id,
                "program_id": p.program_id,
                "program_name": program.name if program else "(unknown)",
                "name": p.name,
                "description": p.description,
                "language": p.language,
                "state": p.state,
                "application_count": d.get("application_count", 0),
                "iteration_count": d.get("iteration_count", 0),
                "latest_dev_qwk": d.get("latest_dev_qwk"),
                "hh_baseline_qwk": d.get("hh_baseline_qwk"),
                "created_at": p.created_at,
                "updated_at": p.updated_at,
            })
        return out

    def get_detail(self, project_id: int) -> dict:
        project = self.repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        program = self.program_repo.get_by_id(project.program_id)
        derived = _derived_for_projects([project_id]).get(project_id, {})
        return {
            "id": project.id,
            "program_id": project.program_id,
            "program_name": program.name if program else "(unknown)",
            "name": project.name,
            "description": project.description,
            "language": project.language,
            "state": project.state,
            "random_seed": project.random_seed,
            "cloned_from_id": project.cloned_from_id,
            "application_count": derived.get("application_count", 0),
            "iteration_count": derived.get("iteration_count", 0),
            "has_locked_prompt": derived.get("has_locked_prompt", False),
            "created_by": project.created_by,
            "created_at": project.created_at,
            "updated_at": project.updated_at,
        }

    # ------------------------------------------------------------------
    # Write paths
    # ------------------------------------------------------------------

    def create(
        self,
        program_id: int,
        name: str,
        description: str | None,
        language: str | None,
        user_id: int,
    ) -> int:
        if not self.program_repo.get_by_id(program_id):
            raise ValueError(f"Program {program_id} not found")
        if not name or not name.strip():
            raise ValueError("Project name is required")

        project_id = self.repo.create(Project(
            program_id=program_id,
            name=name,
            description=description,
            language=language,
            state="setup",
            random_seed=random.randint(0, 2**31 - 1),
            created_by=user_id,
        ))
        self.audit.log("project", project_id, "created", user_id=user_id, details={
            "name": name, "program_id": program_id,
        })
        logger.info("Created project %d '%s' in program %d (user %d)",
                    project_id, name, program_id, user_id)
        return project_id

    def update_metadata(
        self,
        project_id: int,
        name: str | None,
        description: str | None,
        language: str | None,
        user_id: int,
    ) -> None:
        project = self.repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        if name is not None and not name.strip():
            raise ValueError("Project name cannot be blank")
        self.repo.update_metadata(project_id, name=name, description=description, language=language)
        self.audit.log("project", project_id, "metadata_updated", user_id=user_id, details={
            "name": name, "description": description, "language": language,
        })

    def transition_state(self, project_id: int, new_state: str, user_id: int) -> None:
        project = self.repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        allowed = VALID_TRANSITIONS.get(project.state, [])
        if new_state not in allowed:
            raise ValueError(
                f"Cannot transition from '{project.state}' to '{new_state}'. "
                f"Allowed: {allowed or '(terminal state)'}"
            )
        old_state = project.state
        self.repo.update_state(project_id, new_state)
        self.audit.log("project", project_id, "state_transition", user_id=user_id, details={
            "from": old_state, "to": new_state,
        })
        logger.info("Project %d: %s -> %s (user %d)", project_id, old_state, new_state, user_id)

    def delete(self, project_id: int, user_id: int) -> None:
        project = self.repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        # Cascade handles criteria/questions/apps/scores/iterations/etc; locked_prompts SET NULL.
        self.repo.delete(project_id)
        self.audit.log("project", project_id, "deleted", user_id=user_id, details={"name": project.name})
        logger.info("Deleted project %d (user %d)", project_id, user_id)

    def clone(self, source_id: int, new_name: str, user_id: int) -> int:
        """Clone a project: copies rubric + dataset (questions, applications, human scores).

        - Fresh `random_seed` so the new project's splits are independent.
        - State resets to 'setup'.
        - `cloned_from_id` records lineage.
        - JSON references (answers_json keyed by question.key, criteria.feeding_question_keys_json)
          carry over verbatim — no ID remapping needed because everything is keyed by string.
        """
        source = self.repo.get_by_id(source_id)
        if not source:
            raise ValueError(f"Source project {source_id} not found")
        if not new_name or not new_name.strip():
            raise ValueError("Clone name is required")

        new_id = self.repo.create(Project(
            program_id=source.program_id,
            name=new_name,
            description=source.description,
            language=source.language,
            state="setup",
            random_seed=random.randint(0, 2**31 - 1),
            cloned_from_id=source_id,
            created_by=user_id,
        ))

        # Copy questions (key is the stable identifier; preserve type so
        # demographic/metadata tags carry over).
        old_questions = self.question_repo.get_by_project(source_id)
        self.question_repo.replace_all(new_id, [
            Question(
                project_id=new_id,
                key=q.key,
                text=q.text,
                type=q.type,
                sort_order=q.sort_order,
                column_index=q.column_index,
            )
            for q in old_questions
        ])

        # Copy criteria — JSON key references carry over unchanged.
        old_criteria = self.criteria_repo.get_by_project(source_id)
        self.criteria_repo.replace_all(new_id, [
            Criterion(
                project_id=new_id,
                name=c.name,
                description=c.description,
                scale_min=c.scale_min,
                scale_max=c.scale_max,
                anchor_descriptions_json=c.anchor_descriptions_json,
                feeding_question_keys_json=c.feeding_question_keys_json,
                weighted_question_keys_json=c.weighted_question_keys_json,
                sort_order=c.sort_order,
            )
            for c in old_criteria
        ])

        # Copy applications and remember mapping for human_scores.
        old_apps = self.app_repo.get_by_project(source_id)
        aid_map: dict[int, int] = {}
        for a in old_apps:
            new_aid = self.app_repo.create(Application(
                project_id=new_id,
                external_id=a.external_id,
                answers_json=a.answers_json,        # keyed by question.key — carries over
                metadata_json=a.metadata_json,
            ))
            aid_map[a.id] = new_aid

        # Copy human_scores. Criterion ID changes — look up the new criterion by name.
        new_criteria_by_name = {c.name: c.id for c in self.criteria_repo.get_by_project(new_id)}
        old_criteria_by_id = {c.id: c.name for c in old_criteria}

        old_human_scores = self.human_score_repo.get_for_project(source_id)
        if old_human_scores:
            cloned_scores: list[HumanScore] = []
            for hs in old_human_scores:
                old_name = old_criteria_by_id.get(hs.criterion_id)
                new_cid = new_criteria_by_name.get(old_name)
                new_aid = aid_map.get(hs.application_id)
                if new_cid is None or new_aid is None:
                    continue   # criterion or app was missing — skip silently
                cloned_scores.append(HumanScore(
                    application_id=new_aid,
                    criterion_id=new_cid,
                    evaluator_id=hs.evaluator_id,
                    score=hs.score,
                ))
            self.human_score_repo.bulk_create(cloned_scores)

        self.audit.log("project", new_id, "cloned", user_id=user_id, details={
            "source_id": source_id, "source_name": source.name,
        })
        logger.info("Cloned project %d -> %d as '%s' (user %d)",
                    source_id, new_id, new_name, user_id)
        return new_id


# ------------------------------------------------------------------
# Internal helpers — bulk-fetch derived data with one query per concern.
# ------------------------------------------------------------------


def _derived_for_projects(project_ids: list[int]) -> dict[int, dict]:
    """Compute application_count, iteration_count, latest_dev_qwk, hh_baseline_qwk,
    has_locked_prompt for a list of project IDs. One query per concern.
    """
    if not project_ids:
        return {}

    placeholders = ",".join("?" for _ in project_ids)
    out: dict[int, dict] = {pid: {} for pid in project_ids}

    with get_db_cursor() as cursor:
        # application_count
        cursor.execute(
            f"""SELECT project_id, COUNT(*) AS cnt FROM applications
                WHERE project_id IN ({placeholders}) GROUP BY project_id""",
            project_ids,
        )
        for row in cursor.fetchall():
            out[row["project_id"]]["application_count"] = row["cnt"]

        # iteration_count
        cursor.execute(
            f"""SELECT project_id, COUNT(*) AS cnt FROM iterations
                WHERE project_id IN ({placeholders}) GROUP BY project_id""",
            project_ids,
        )
        for row in cursor.fetchall():
            out[row["project_id"]]["iteration_count"] = row["cnt"]

        # latest_dev_qwk: project-overall (criterion_id NULL) qwk for the most recent iteration on dev split
        cursor.execute(
            f"""SELECT am.project_id, am.value
                FROM agreement_metrics am
                JOIN (
                    SELECT project_id, MAX(version) AS max_v
                    FROM iterations
                    WHERE project_id IN ({placeholders})
                    GROUP BY project_id
                ) latest ON latest.project_id = am.project_id
                JOIN iterations i ON i.project_id = am.project_id
                                  AND i.version = latest.max_v
                                  AND i.id = am.iteration_id
                WHERE am.split = 'dev'
                  AND am.criterion_id IS NULL
                  AND am.metric = 'qwk'""",
            project_ids,
        )
        for row in cursor.fetchall():
            out[row["project_id"]]["latest_dev_qwk"] = row["value"]

        # hh_baseline_qwk: iteration_id IS NULL, criterion_id IS NULL, metric='qwk', split='all'
        cursor.execute(
            f"""SELECT project_id, value FROM agreement_metrics
                WHERE project_id IN ({placeholders})
                  AND iteration_id IS NULL
                  AND criterion_id IS NULL
                  AND metric = 'qwk'
                  AND split = 'all'""",
            project_ids,
        )
        for row in cursor.fetchall():
            out[row["project_id"]]["hh_baseline_qwk"] = row["value"]

        # has_locked_prompt
        cursor.execute(
            f"""SELECT DISTINCT project_id FROM locked_prompts
                WHERE project_id IN ({placeholders})""",
            project_ids,
        )
        locked = {row["project_id"] for row in cursor.fetchall()}
        for pid in project_ids:
            out[pid]["has_locked_prompt"] = pid in locked

    return out
