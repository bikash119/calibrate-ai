"""Iterations API — versioned per-criterion prompts within a project."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    CriterionDiff,
    CriterionPromptItem,
    DiffLineItem,
    DiffResponse,
    IterationCreateRequest,
    IterationCriterionMetric,
    IterationDetailResponse,
    IterationItem,
    IterationsListResponse,
)
from api.services.iteration_service import IterationService

logger = logging.getLogger("scoring_ai.routes.iterations")

router = APIRouter(prefix="/api/projects/{project_id}", tags=["iterations"])


@router.get("/iterations", response_model=IterationsListResponse)
def list_iterations(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> IterationsListResponse:
    """List iterations for a project with derived dev/validation metrics per criterion."""
    try:
        rows = IterationService().list_with_metrics(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return IterationsListResponse(
        project_id=project_id,
        iterations=[
            IterationItem(
                id=r["id"],
                project_id=r["project_id"],
                version=r["version"],
                note=r["note"],
                dev_metrics=[IterationCriterionMetric(**m) for m in r["dev_metrics"]],
                validation_metrics=[IterationCriterionMetric(**m) for m in r["validation_metrics"]],
                overall_dev_qwk=r["overall_dev_qwk"],
                overall_validation_qwk=r["overall_validation_qwk"],
                created_at=r["created_at"],
            )
            for r in rows
        ],
    )


@router.post("/iterations", response_model=IterationDetailResponse, status_code=201)
def create_iteration(
    project_id: int,
    body: IterationCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> IterationDetailResponse:
    """Create a new iteration.

    If `prompts` is empty, auto-generate from the rubric (with active calibration
    examples injected). Otherwise every project criterion must have exactly one
    matching entry.
    """
    service = IterationService()
    prompts = [p.model_dump() for p in body.prompts] if body.prompts else None
    try:
        iteration_id = service.create(
            project_id, prompts, body.note, int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return _detail_response(service, project_id, iteration_id)


@router.get("/iterations/{iteration_id}", response_model=IterationDetailResponse)
def get_iteration(
    project_id: int,
    iteration_id: int,
    _: dict = Depends(get_current_user),
) -> IterationDetailResponse:
    """Fetch an iteration with its prompts and metrics."""
    try:
        return _detail_response(IterationService(), project_id, iteration_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/iterations/{from_version}/diff/{to_version}", response_model=DiffResponse)
def diff_iterations(
    project_id: int,
    from_version: int,
    to_version: int,
    _: dict = Depends(get_current_user),
) -> DiffResponse:
    """Per-criterion unified diff between two iteration versions."""
    try:
        d = IterationService().diff(project_id, from_version, to_version)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return DiffResponse(
        project_id=d["project_id"],
        from_version=d["from_version"],
        to_version=d["to_version"],
        per_criterion=[
            CriterionDiff(
                criterion_id=c["criterion_id"],
                criterion_name=c["criterion_name"],
                lines=[DiffLineItem(**l) for l in c["lines"]],
            )
            for c in d["per_criterion"]
        ],
    )


def _detail_response(service: IterationService, project_id: int, iteration_id: int) -> IterationDetailResponse:
    d = service.get_detail(project_id, iteration_id)
    return IterationDetailResponse(
        id=d["id"],
        project_id=d["project_id"],
        version=d["version"],
        note=d["note"],
        prompts=[CriterionPromptItem(**p) for p in d["prompts"]],
        dev_metrics=[IterationCriterionMetric(**m) for m in d["dev_metrics"]],
        validation_metrics=[IterationCriterionMetric(**m) for m in d["validation_metrics"]],
        created_at=d["created_at"],
    )
