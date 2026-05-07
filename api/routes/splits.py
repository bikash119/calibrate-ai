"""Splits API — nested under /api/projects/{id}/splits."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import SplitCountsResponse
from api.services.split_service import SplitService

logger = logging.getLogger("scoring_ai.routes.splits")

router = APIRouter(prefix="/api/projects/{project_id}", tags=["splits"])


@router.get("/splits", response_model=SplitCountsResponse)
def get_splits(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> SplitCountsResponse:
    """Return current split counts for a project."""
    try:
        return SplitCountsResponse(**SplitService().get_counts(project_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/splits", response_model=SplitCountsResponse, status_code=201)
def regenerate_splits(
    project_id: int,
    current_user: dict = Depends(get_current_user),
) -> SplitCountsResponse:
    """(Re)generate 60/20/20 holdout splits using project.random_seed.

    Refuses if any test-split scoring job has already completed (validity guard).
    """
    try:
        return SplitCountsResponse(**SplitService().regenerate(project_id, int(current_user["sub"])))
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        if "test split has already been used" in msg:
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
