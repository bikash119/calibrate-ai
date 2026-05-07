"""Rubric (criteria) management — atomic replace + get."""

import json
import logging

from db_models import (
    AuditLogRepository,
    Criterion,
    CriteriaRepository,
    ProjectRepository,
    QuestionRepository,
)

logger = logging.getLogger("scoring_ai.services.rubric")


class RubricService:
    """Manages the per-project criteria set (the rubric)."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.criteria_repo = CriteriaRepository()
        self.question_repo = QuestionRepository()
        self.audit = AuditLogRepository()

    def get(self, project_id: int) -> list[dict]:
        """Return the rubric as a list of dicts ready for CriterionItem construction."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        criteria = self.criteria_repo.get_by_project(project_id)
        return [_criterion_to_dict(c) for c in criteria]

    def save(
        self,
        project_id: int,
        criteria_inputs: list[dict],
        user_id: int,
    ) -> None:
        """Atomically replace all criteria for a project.

        Each input is a dict with keys: name, description, scale_min, scale_max,
        anchor_descriptions, feeding_question_keys, weighted_question_keys, sort_order.
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        if not criteria_inputs:
            raise ValueError("Rubric must have at least one criterion")

        # Validate anchor coverage and scale bounds.
        for c in criteria_inputs:
            if c["scale_max"] <= c["scale_min"]:
                raise ValueError(
                    f"Criterion '{c['name']}' has scale_max ({c['scale_max']}) <= scale_min ({c['scale_min']})"
                )
            anchors = c.get("anchor_descriptions") or {}
            expected = {str(v) for v in range(c["scale_min"], c["scale_max"] + 1)}
            missing = expected - set(anchors.keys())
            if missing:
                raise ValueError(
                    f"Criterion '{c['name']}' is missing anchor descriptions for: {sorted(missing)}"
                )

        # Validate that referenced question keys exist (warn-only would be friendlier;
        # for now we hard-fail to catch typos early).
        valid_keys = {q.key for q in self.question_repo.get_by_project(project_id)}
        for c in criteria_inputs:
            for k in c.get("feeding_question_keys", []):
                if k not in valid_keys:
                    raise ValueError(
                        f"Criterion '{c['name']}' references unknown feeding question key '{k}'"
                    )
            for k in c.get("weighted_question_keys", []):
                if k not in valid_keys:
                    raise ValueError(
                        f"Criterion '{c['name']}' references unknown weighted question key '{k}'"
                    )

        # Reject duplicate names.
        names = [c["name"] for c in criteria_inputs]
        if len(set(names)) != len(names):
            raise ValueError("Criterion names must be unique within a rubric")

        # Persist (atomic replace).
        rows = [
            Criterion(
                project_id=project_id,
                name=c["name"],
                description=c["description"],
                scale_min=c["scale_min"],
                scale_max=c["scale_max"],
                anchor_descriptions_json=json.dumps(c["anchor_descriptions"]),
                feeding_question_keys_json=json.dumps(c.get("feeding_question_keys", [])),
                weighted_question_keys_json=json.dumps(c.get("weighted_question_keys", [])),
                sort_order=c.get("sort_order", i),
            )
            for i, c in enumerate(criteria_inputs)
        ]
        self.criteria_repo.replace_all(project_id, rows)
        self.audit.log("project", project_id, "rubric_saved", user_id=user_id, details={
            "criterion_count": len(rows),
        })
        logger.info("Saved rubric for project %d (%d criteria, user %d)",
                    project_id, len(rows), user_id)


def _criterion_to_dict(c: Criterion) -> dict:
    """Convert a Criterion dataclass to a dict suitable for CriterionItem(**…)."""
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "scale_min": c.scale_min,
        "scale_max": c.scale_max,
        "anchor_descriptions": json.loads(c.anchor_descriptions_json or "{}"),
        "feeding_question_keys": json.loads(c.feeding_question_keys_json or "[]"),
        "weighted_question_keys": json.loads(c.weighted_question_keys_json or "[]"),
        "sort_order": c.sort_order,
    }
