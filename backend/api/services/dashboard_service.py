"""Top-level dashboard aggregations — projects-by-state, programs/locked-prompts counts."""

import logging

from database import get_db_cursor

logger = logging.getLogger("scoring_ai.services.dashboard")


class DashboardService:
    """Aggregate counts for the projects dashboard."""

    def stats(self) -> dict:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT state, COUNT(*) AS cnt FROM projects GROUP BY state")
            projects_by_state = {row["state"]: row["cnt"] for row in cursor.fetchall()}

            cursor.execute("SELECT COUNT(*) AS cnt FROM programs")
            programs_count = cursor.fetchone()["cnt"]

            cursor.execute("SELECT COUNT(*) AS cnt FROM locked_prompts")
            locked_prompts_count = cursor.fetchone()["cnt"]

        return {
            "projects_by_state": projects_by_state,
            "programs_count": programs_count,
            "locked_prompts_count": locked_prompts_count,
        }
