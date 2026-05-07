"""Locked prompts API — finalize a calibration and read the artifact."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    LockProjectRequest,
    LockedPromptDetailResponse,
    LockedPromptItem,
    LockedPromptsListResponse,
)
from api.services.locked_prompt_service import LockedPromptService

logger = logging.getLogger("scoring_ai.routes.locked_prompts")


# ------------------------------------------------------------------ #
# Lock action (project-scoped)                                       #
# ------------------------------------------------------------------ #

lock_router = APIRouter(prefix="/api/projects/{project_id}", tags=["locked_prompts"])


@lock_router.post("/lock", response_model=LockedPromptDetailResponse, status_code=201)
def lock_project(
    project_id: int,
    body: LockProjectRequest,
    current_user: dict = Depends(get_current_user),
) -> LockedPromptDetailResponse:
    """Finalize a project — snapshot rubric + prompts + examples + test metrics.

    Project must be in 'test_run_complete' state and have a completed test-split
    scoring job. The project transitions to 'locked' on success.
    """
    service = LockedPromptService()
    try:
        locked_id = service.lock(project_id, body.name, int(current_user["sub"]))
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        if "must be in state" in msg or "no completed" in msg:
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return LockedPromptDetailResponse(**service.get_detail(locked_id))


# ------------------------------------------------------------------ #
# Library (cross-project)                                            #
# ------------------------------------------------------------------ #

library_router = APIRouter(prefix="/api/locked-prompts", tags=["locked_prompts"])


@library_router.get("", response_model=LockedPromptsListResponse)
def list_locked_prompts(_: dict = Depends(get_current_user)) -> LockedPromptsListResponse:
    """List all locked prompts (across projects, including orphans)."""
    rows = LockedPromptService().list_all()
    return LockedPromptsListResponse(
        locked_prompts=[LockedPromptItem(**r) for r in rows],
    )


@library_router.get("/{locked_id}", response_model=LockedPromptDetailResponse)
def get_locked_prompt(
    locked_id: int,
    _: dict = Depends(get_current_user),
) -> LockedPromptDetailResponse:
    """Read a locked prompt with its full snapshots (rubric, prompts, examples, metrics)."""
    try:
        return LockedPromptDetailResponse(**LockedPromptService().get_detail(locked_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
