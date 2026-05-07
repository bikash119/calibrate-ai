"""Disagreement API — feed for triage + flag CRUD."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_current_user
from api.schemas import (
    DisagreementFlagCountsResponse,
    DisagreementFlagRequest,
    DisagreementItem,
    DisagreementsResponse,
)
from api.services.disagreement_service import DisagreementService

logger = logging.getLogger("scoring_ai.routes.disagreements")


# ------------------------------------------------------------------ #
# Iteration-scoped feed                                              #
# ------------------------------------------------------------------ #

iteration_router = APIRouter(
    prefix="/api/projects/{project_id}/iterations/{iteration_id}",
    tags=["disagreements"],
)


@iteration_router.get("/disagreements", response_model=DisagreementsResponse)
def list_disagreements(
    project_id: int,
    iteration_id: int,
    split: str = Query("dev"),
    _: dict = Depends(get_current_user),
) -> DisagreementsResponse:
    """List LLM-vs-human disagreements for an iteration on a split, sorted by |delta| desc."""
    try:
        rows = DisagreementService().list_disagreements(project_id, iteration_id, split)
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return DisagreementsResponse(
        project_id=project_id,
        iteration_id=iteration_id,
        disagreements=[DisagreementItem(**r) for r in rows],
    )


# ------------------------------------------------------------------ #
# Project-scoped flag CRUD                                           #
# ------------------------------------------------------------------ #

project_router = APIRouter(prefix="/api/projects/{project_id}", tags=["disagreements"])


@project_router.post("/disagreements/flag", status_code=204)
def flag_disagreement(
    project_id: int,
    body: DisagreementFlagRequest,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Set or update a disagreement flag for an (application, criterion)."""
    try:
        DisagreementService().upsert_flag(
            project_id, body.application_id, body.criterion_id, body.flag,
            int(current_user["sub"]),
        )
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))


@project_router.get("/disagreements/counts", response_model=DisagreementFlagCountsResponse)
def get_flag_counts(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> DisagreementFlagCountsResponse:
    """Count of flags grouped by value."""
    try:
        counts = DisagreementService().counts_by_flag(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return DisagreementFlagCountsResponse(project_id=project_id, counts=counts)
