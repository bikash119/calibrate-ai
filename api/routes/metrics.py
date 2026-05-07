"""Agreement metrics API — H-H baseline + LLM-H per iteration."""

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    AgreementMetricItem,
    BaselineResponse,
    IterationMetricsResponse,
)
from api.services.metrics_service import MetricsService

logger = logging.getLogger("scoring_ai.routes.metrics")


# ------------------------------------------------------------------ #
# H-H baseline (project-scoped)                                      #
# ------------------------------------------------------------------ #

baseline_router = APIRouter(prefix="/api/projects/{project_id}", tags=["metrics"])


@baseline_router.get("/baseline", response_model=BaselineResponse)
def get_baseline(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> BaselineResponse:
    """Read the persisted H-H baseline for this project."""
    try:
        d = MetricsService().get_baseline(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return _baseline_response(d)


@baseline_router.post("/baseline/compute", response_model=BaselineResponse)
def compute_baseline(
    project_id: int,
    current_user: dict = Depends(get_current_user),
) -> BaselineResponse:
    """Compute (or recompute) the H-H baseline. Synchronous — usually fast.

    Note: this is intentionally not a background task; baseline computation
    over thousands of human scores still completes well under a second.
    """
    try:
        d = MetricsService().compute_baseline(project_id, int(current_user["sub"]))
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return _baseline_response(d)


# ------------------------------------------------------------------ #
# LLM-H per iteration                                                 #
# ------------------------------------------------------------------ #

iteration_router = APIRouter(
    prefix="/api/projects/{project_id}/iterations/{iteration_id}",
    tags=["metrics"],
)


@iteration_router.get("/metrics", response_model=IterationMetricsResponse)
def get_iteration_metrics(
    project_id: int,
    iteration_id: int,
    split: str,
    _: dict = Depends(get_current_user),
) -> IterationMetricsResponse:
    """Read persisted LLM-H metrics for an iteration on a split."""
    d = MetricsService().get_iteration_metrics(project_id, iteration_id, split)
    return _iteration_metrics_response(d)


@iteration_router.post("/metrics/compute", response_model=IterationMetricsResponse)
def compute_iteration_metrics(
    project_id: int,
    iteration_id: int,
    split: str,
    current_user: dict = Depends(get_current_user),
) -> IterationMetricsResponse:
    """Compute LLM-H metrics for an iteration on a split.

    Uses the latest completed scoring job for that (iteration, split) pair.
    """
    try:
        d = MetricsService().compute_iteration_metrics(
            project_id, iteration_id, split, int(current_user["sub"]),
        )
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return _iteration_metrics_response(d)


# ------------------------------------------------------------------ #
# Internal converters                                                 #
# ------------------------------------------------------------------ #


def _baseline_response(d: dict) -> BaselineResponse:
    return BaselineResponse(
        project_id=d["project_id"],
        per_criterion=[AgreementMetricItem(**m) for m in d["per_criterion"]],
        overall=[AgreementMetricItem(**m) for m in d["overall"]],
        evaluator_count=d["evaluator_count"],
    )


def _iteration_metrics_response(d: dict) -> IterationMetricsResponse:
    return IterationMetricsResponse(
        project_id=d["project_id"],
        iteration_id=d["iteration_id"],
        split=d["split"],
        per_criterion=[AgreementMetricItem(**m) for m in d["per_criterion"]],
        overall=[AgreementMetricItem(**m) for m in d["overall"]],
    )
