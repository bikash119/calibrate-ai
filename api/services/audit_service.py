"""Audit-log read paths.

Writing happens directly via `AuditLogRepository.log()` from individual services
(state transitions, scoring submissions, lock events, etc.). This service
exposes the read paths with usernames joined for display.
"""

import json
import logging

from database import get_db_cursor

logger = logging.getLogger("scoring_ai.services.audit")


class AuditService:
    """Read-only audit log access. Entries are append-only — no updates."""

    def get_for_entity(self, entity_type: str, entity_id: int) -> list[dict]:
        """Entries for a specific (entity_type, entity_id) pair, newest first."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT a.id, a.user_id, u.username AS user_username,
                          a.entity_type, a.entity_id, a.action, a.details_json,
                          a.created_at
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.user_id
                   WHERE a.entity_type = ? AND a.entity_id = ?
                   ORDER BY a.created_at DESC, a.id DESC""",
                (entity_type, entity_id),
            )
            return [_row_to_dict(row) for row in cursor.fetchall()]

    def get_recent(self, limit: int = 100) -> list[dict]:
        """Cross-entity recent activity, newest first."""
        with get_db_cursor() as cursor:
            cursor.execute(
                """SELECT a.id, a.user_id, u.username AS user_username,
                          a.entity_type, a.entity_id, a.action, a.details_json,
                          a.created_at
                   FROM audit_log a
                   LEFT JOIN users u ON u.id = a.user_id
                   ORDER BY a.created_at DESC, a.id DESC
                   LIMIT ?""",
                (limit,),
            )
            return [_row_to_dict(row) for row in cursor.fetchall()]


def _row_to_dict(row) -> dict:
    raw_details = row["details_json"]
    details: dict | None = None
    if raw_details:
        try:
            parsed = json.loads(raw_details)
            details = parsed if isinstance(parsed, dict) else {"value": parsed}
        except (TypeError, ValueError):
            details = {"raw": raw_details}
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "user_username": row["user_username"],
        "entity_type": row["entity_type"],
        "entity_id": row["entity_id"],
        "action": row["action"],
        "details": details,
        "created_at": row["created_at"],
    }
