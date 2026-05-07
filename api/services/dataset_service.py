"""Dataset management — questions, applications, human scores.

This is the JSON-shaped slice of the project: what the operator actually uploads
(or wires together by hand). LLM scoring lives elsewhere; this service is plain
data ingest + retrieval.
"""

import json
import logging

from db_models import (
    Application,
    ApplicationRepository,
    AuditLogRepository,
    CriteriaRepository,
    HumanScore,
    HumanScoreRepository,
    ProjectRepository,
    Question,
    QuestionRepository,
)

logger = logging.getLogger("scoring_ai.services.dataset")


class DatasetService:
    """Per-project dataset operations."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.question_repo = QuestionRepository()
        self.app_repo = ApplicationRepository()
        self.criteria_repo = CriteriaRepository()
        self.human_score_repo = HumanScoreRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Questions                                                          #
    # ------------------------------------------------------------------ #

    def get_questions(self, project_id: int) -> list[Question]:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        return self.question_repo.get_by_project(project_id)

    def save_questions(
        self,
        project_id: int,
        questions: list[dict],
        user_id: int,
    ) -> None:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        keys = [q["key"] for q in questions]
        if len(set(keys)) != len(keys):
            raise ValueError("Question keys must be unique within a project")
        for q in questions:
            if not q["key"] or not q["key"].strip():
                raise ValueError("Question key cannot be blank")
            if not q["text"] or not q["text"].strip():
                raise ValueError(f"Question '{q['key']}' has no text")

        rows = [
            Question(
                project_id=project_id,
                key=q["key"],
                text=q["text"],
                sort_order=q.get("sort_order", i),
            )
            for i, q in enumerate(questions)
        ]
        self.question_repo.replace_all(project_id, rows)
        self.audit.log("project", project_id, "questions_saved", user_id=user_id, details={
            "question_count": len(rows),
        })
        logger.info("Saved %d questions for project %d (user %d)",
                    len(rows), project_id, user_id)

    # ------------------------------------------------------------------ #
    # Applications                                                       #
    # ------------------------------------------------------------------ #

    def list_applications(self, project_id: int) -> list[dict]:
        """List applications, annotated with whether they have any human scores."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        apps = self.app_repo.get_by_project(project_id)
        if not apps:
            return []

        # Single query for "has any human score" per app.
        scored_ids = {hs.application_id for hs in self.human_score_repo.get_for_project(project_id)}
        return [
            {
                "id": a.id,
                "external_id": a.external_id,
                "has_human_scores": a.id in scored_ids,
                "created_at": a.created_at,
            }
            for a in apps
        ]

    def get_application(self, project_id: int, application_id: int) -> dict:
        app = self.app_repo.get_by_id(application_id)
        if not app or app.project_id != project_id:
            raise ValueError(f"Application {application_id} not found in project {project_id}")
        return {
            "id": app.id,
            "project_id": app.project_id,
            "external_id": app.external_id,
            "answers": json.loads(app.answers_json or "{}"),
            "metadata": json.loads(app.metadata_json) if app.metadata_json else None,
            "created_at": app.created_at,
        }

    def upsert_applications(
        self,
        project_id: int,
        applications: list[dict],
        user_id: int,
    ) -> int:
        """Bulk-insert applications. Each input has external_id, answers (dict), optional metadata."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        if not applications:
            raise ValueError("Cannot upsert an empty application list")

        valid_keys = {q.key for q in self.question_repo.get_by_project(project_id)}
        if not valid_keys:
            raise ValueError(
                "Project has no questions defined yet. Save questions before uploading applications."
            )

        rows: list[Application] = []
        for a in applications:
            if not a.get("external_id"):
                raise ValueError("Application is missing external_id")
            answers = a.get("answers") or {}
            if not isinstance(answers, dict):
                raise ValueError(f"Application '{a['external_id']}' answers must be a dict")
            unknown = set(answers.keys()) - valid_keys
            if unknown:
                raise ValueError(
                    f"Application '{a['external_id']}' has answers for unknown question keys: {sorted(unknown)}"
                )
            rows.append(Application(
                project_id=project_id,
                external_id=a["external_id"],
                answers_json=json.dumps(answers, ensure_ascii=False),
                metadata_json=json.dumps(a["metadata"], ensure_ascii=False) if a.get("metadata") else None,
            ))

        ids = self.app_repo.bulk_create(rows)
        self.audit.log("project", project_id, "applications_loaded", user_id=user_id, details={
            "application_count": len(ids),
        })
        logger.info("Loaded %d applications for project %d (user %d)",
                    len(ids), project_id, user_id)
        return len(ids)

    # ------------------------------------------------------------------ #
    # Human scores                                                       #
    # ------------------------------------------------------------------ #

    def list_human_scores(self, project_id: int) -> list[HumanScore]:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        return self.human_score_repo.get_for_project(project_id)

    def upsert_human_scores(
        self,
        project_id: int,
        scores: list[dict],
        user_id: int,
    ) -> int:
        """Bulk-insert human scores.

        Each input has external_id (application), criterion_name, evaluator_id, score.
        We resolve external_id -> application.id and criterion_name -> criterion.id.
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        if not scores:
            raise ValueError("Cannot upsert an empty score list")

        apps_by_external = {
            a.external_id: a.id for a in self.app_repo.get_by_project(project_id)
        }
        criteria = self.criteria_repo.get_by_project(project_id)
        criteria_by_name = {c.name: c for c in criteria}
        if not apps_by_external:
            raise ValueError("Project has no applications. Upload applications before scores.")
        if not criteria_by_name:
            raise ValueError("Project has no rubric. Save the rubric before uploading scores.")

        rows: list[HumanScore] = []
        for s in scores:
            ext = s.get("external_id")
            crit_name = s.get("criterion_name")
            evaluator = s.get("evaluator_id")
            score_val = s.get("score")
            if not ext or not crit_name or not evaluator or score_val is None:
                raise ValueError(
                    f"Score entry missing one of (external_id, criterion_name, evaluator_id, score): {s}"
                )
            app_id = apps_by_external.get(ext)
            if app_id is None:
                raise ValueError(f"Unknown application external_id '{ext}'")
            crit = criteria_by_name.get(crit_name)
            if crit is None:
                raise ValueError(f"Unknown criterion '{crit_name}'")
            if not (crit.scale_min <= score_val <= crit.scale_max):
                raise ValueError(
                    f"Score {score_val} for '{ext}' / '{crit_name}' is outside scale {crit.scale_min}..{crit.scale_max}"
                )
            rows.append(HumanScore(
                application_id=app_id,
                criterion_id=crit.id,
                evaluator_id=str(evaluator),
                score=score_val,
            ))

        n = self.human_score_repo.bulk_create(rows)
        self.audit.log("project", project_id, "human_scores_loaded", user_id=user_id, details={
            "score_count": n,
        })
        logger.info("Loaded %d human scores for project %d (user %d)",
                    n, project_id, user_id)
        return n

    # ------------------------------------------------------------------ #
    # Median helper (server-derived; not stored)                         #
    # ------------------------------------------------------------------ #

    def medians_for_criterion(
        self, project_id: int, criterion_id: int
    ) -> list[dict]:
        """Compute the per-application median across evaluators for one criterion."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        scores = self.human_score_repo.get_for_project(project_id)
        # group by app_id
        by_app: dict[int, list[int]] = {}
        for hs in scores:
            if hs.criterion_id != criterion_id:
                continue
            by_app.setdefault(hs.application_id, []).append(hs.score)

        out: list[dict] = []
        for app_id, raw in by_app.items():
            sorted_scores = sorted(raw)
            n = len(sorted_scores)
            if n == 0:
                continue
            mid = n // 2
            median = (
                sorted_scores[mid] if n % 2 == 1
                else (sorted_scores[mid - 1] + sorted_scores[mid]) / 2.0
            )
            out.append({
                "application_id": app_id,
                "criterion_id": criterion_id,
                "median": float(median),
                "n": n,
                "individual_scores": sorted_scores,
            })
        return out
