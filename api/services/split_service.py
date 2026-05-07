"""60/20/20 holdout splits, derived from project.random_seed.

The strategy is intentionally simple. v2 can add k-fold without changing the
project state machine — just add a new method here and a new endpoint.
"""

import logging
import random

from db_models import (
    ApplicationRepository,
    AuditLogRepository,
    ProjectRepository,
    ScoringJobRepository,
    Split,
    SplitRepository,
)

logger = logging.getLogger("scoring_ai.services.split")


DEV_RATIO = 0.60
VAL_RATIO = 0.20
# remainder goes to test
MIN_APPLICATIONS = 10


class SplitService:
    """Generate, query, and (carefully) regenerate holdout splits."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.app_repo = ApplicationRepository()
        self.split_repo = SplitRepository()
        self.job_repo = ScoringJobRepository()
        self.audit = AuditLogRepository()

    def get_counts(self, project_id: int) -> dict:
        """Return current split counts plus whether the test split has been consumed."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        counts = self.split_repo.count_by_split(project_id)
        return {
            "project_id": project_id,
            "counts": counts,
            "test_consumed": self._is_test_consumed(project_id),
        }

    def regenerate(self, project_id: int, user_id: int) -> dict:
        """Generate fresh splits using project.random_seed.

        Refuses to regenerate if the test split has already been consumed —
        re-rolling after seeing the test set destroys validity.
        """
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        if self._is_test_consumed(project_id):
            raise ValueError(
                "Test split has already been used by a completed scoring job. "
                "Cannot regenerate splits without compromising validity."
            )

        app_ids = self.app_repo.get_ids_by_project(project_id)
        if len(app_ids) < MIN_APPLICATIONS:
            raise ValueError(
                f"Need at least {MIN_APPLICATIONS} applications for a holdout split, "
                f"got {len(app_ids)}"
            )

        rng = random.Random(project.random_seed)
        shuffled = list(app_ids)
        rng.shuffle(shuffled)

        n = len(shuffled)
        n_dev = max(1, int(n * DEV_RATIO))
        n_val = max(1, int(n * VAL_RATIO))
        # remainder goes to test
        dev_ids = shuffled[:n_dev]
        val_ids = shuffled[n_dev:n_dev + n_val]
        test_ids = shuffled[n_dev + n_val:]

        rows: list[Split] = []
        for aid in dev_ids:
            rows.append(Split(project_id=project_id, application_id=aid, split="dev"))
        for aid in val_ids:
            rows.append(Split(project_id=project_id, application_id=aid, split="validation"))
        for aid in test_ids:
            rows.append(Split(project_id=project_id, application_id=aid, split="test"))

        self.split_repo.replace_all(project_id, rows)

        counts = {"dev": len(dev_ids), "validation": len(val_ids), "test": len(test_ids)}
        self.audit.log("project", project_id, "splits_generated", user_id=user_id, details={
            "seed": project.random_seed, "counts": counts,
        })
        logger.info(
            "Generated splits for project %d (seed=%d, dev=%d val=%d test=%d, user %d)",
            project_id, project.random_seed,
            counts["dev"], counts["validation"], counts["test"], user_id,
        )
        return {
            "project_id": project_id,
            "counts": counts,
            "test_consumed": False,
        }

    # ------------------------------------------------------------------ #

    def _is_test_consumed(self, project_id: int) -> bool:
        """A completed test-split scoring job marks the test set as consumed."""
        jobs = self.job_repo.get_by_project(project_id)
        return any(j.split == "test" and j.status == "completed" for j in jobs)
