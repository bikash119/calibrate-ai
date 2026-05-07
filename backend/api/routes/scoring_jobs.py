"""Scoring jobs API — submit, poll status, read scores."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    JobScoresResponse,
    LlmScoreItem,
    ScoringJobCreateRequest,
    ScoringJobItem,
    ScoringJobStatusResponse,
    ScoringJobsResponse,
)
from api.services.scoring_job_service import ScoringJobService, run_scoring_job

logger = logging.getLogger("scoring_ai.routes.scoring_jobs")


# ------------------------------------------------------------------ #
# Submit (nested under iterations)                                   #
# ------------------------------------------------------------------ #

submit_router = APIRouter(prefix="/api/projects/{project_id}/iterations", tags=["scoring_jobs"])


@submit_router.post("/{iteration_id}/score", response_model=ScoringJobStatusResponse, status_code=202)
def submit_scoring_job(
    project_id: int,
    iteration_id: int,
    body: ScoringJobCreateRequest,
    background: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
) -> ScoringJobStatusResponse:
    """Submit a scoring job for an iteration on a split. Runs asynchronously."""
    service = ScoringJobService()
    try:
        job_id = service.submit(
            project_id, iteration_id, body.split,
            body.provider, body.model, int(current_user["sub"]),
        )
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        if "already" in msg or "cannot" in msg:
            raise HTTPException(status_code=409, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))

    background.add_task(run_scoring_job, job_id)
    return ScoringJobStatusResponse(**service.get_status(job_id))


# ------------------------------------------------------------------ #
# Project-scoped list                                                #
# ------------------------------------------------------------------ #

list_router = APIRouter(prefix="/api/projects/{project_id}", tags=["scoring_jobs"])


@list_router.get("/scoring-jobs", response_model=ScoringJobsResponse)
def list_scoring_jobs(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> ScoringJobsResponse:
    """List all scoring jobs for a project."""
    try:
        rows = ScoringJobService().list_for_project(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ScoringJobsResponse(
        project_id=project_id,
        jobs=[ScoringJobItem(**r) for r in rows],
    )


# ------------------------------------------------------------------ #
# Job-scoped status / scores / cancel                                #
# ------------------------------------------------------------------ #

job_router = APIRouter(prefix="/api/scoring-jobs", tags=["scoring_jobs"])


@job_router.get("/{job_id}", response_model=ScoringJobStatusResponse)
def get_status(
    job_id: int,
    _: dict = Depends(get_current_user),
) -> ScoringJobStatusResponse:
    """Lightweight status payload for polling."""
    try:
        return ScoringJobStatusResponse(**ScoringJobService().get_status(job_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@job_router.get("/{job_id}/scores", response_model=JobScoresResponse)
def get_job_scores(
    job_id: int,
    _: dict = Depends(get_current_user),
) -> JobScoresResponse:
    """Return all LLM scores produced by this job."""
    try:
        rows = ScoringJobService().get_scores(job_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return JobScoresResponse(
        job_id=job_id,
        scores=[LlmScoreItem(**r) for r in rows],
    )


@job_router.post("/{job_id}/cancel", response_model=ScoringJobStatusResponse)
def cancel_job(
    job_id: int,
    current_user: dict = Depends(get_current_user),
) -> ScoringJobStatusResponse:
    """Cancel a pending or running job."""
    service = ScoringJobService()
    try:
        service.cancel(job_id, int(current_user["sub"]))
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=409, detail=str(e))
    return ScoringJobStatusResponse(**service.get_status(job_id))
