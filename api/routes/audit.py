"""Audit log API — read-only views over the append-only audit_log table."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_current_user
from api.schemas import AuditEntryItem, AuditLogResponse
from api.services.audit_service import AuditService

logger = logging.getLogger("scoring_ai.routes.audit")

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=AuditLogResponse)
def get_for_entity(
    entity_type: str = Query(..., description="e.g. 'project', 'iteration'"),
    entity_id: int = Query(..., description="Entity primary key"),
    _: dict = Depends(get_current_user),
) -> AuditLogResponse:
    """Audit entries for a specific entity, newest first."""
    rows = AuditService().get_for_entity(entity_type, entity_id)
    return AuditLogResponse(entries=[AuditEntryItem(**r) for r in rows])


@router.get("/recent", response_model=AuditLogResponse)
def get_recent(
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(get_current_user),
) -> AuditLogResponse:
    """Cross-entity recent activity."""
    rows = AuditService().get_recent(limit)
    return AuditLogResponse(entries=[AuditEntryItem(**r) for r in rows])
