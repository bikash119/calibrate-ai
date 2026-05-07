"""Rubric API — nested under /api/projects/{id}/rubric."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    CriterionItem,
    RubricResponse,
    RubricSaveRequest,
)
from api.services.rubric_service import RubricService

logger = logging.getLogger("scoring_ai.routes.rubric")

router = APIRouter(prefix="/api/projects/{project_id}", tags=["rubric"])


@router.get("/rubric", response_model=RubricResponse)
def get_rubric(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> RubricResponse:
    """Get the rubric (criteria) for a project."""
    try:
        criteria = RubricService().get(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return RubricResponse(
        project_id=project_id,
        criteria=[CriterionItem(**c) for c in criteria],
    )


@router.put("/rubric", response_model=RubricResponse)
def save_rubric(
    project_id: int,
    body: RubricSaveRequest,
    current_user: dict = Depends(get_current_user),
) -> RubricResponse:
    """Atomically replace the rubric for a project."""
    service = RubricService()
    try:
        service.save(
            project_id,
            [c.model_dump() for c in body.criteria],
            int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return RubricResponse(
        project_id=project_id,
        criteria=[CriterionItem(**c) for c in service.get(project_id)],
    )
