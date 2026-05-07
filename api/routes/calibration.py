"""Calibration examples API — few-shot prompts derived from human-scored apps."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    CalibrationExampleGenerateRequest,
    CalibrationExampleItem,
    CalibrationExampleSetActiveRequest,
    CalibrationExamplesResponse,
)
from api.services.calibration_service import CalibrationService

logger = logging.getLogger("scoring_ai.routes.calibration")


# ------------------------------------------------------------------ #
# Per-criterion list + generate                                       #
# ------------------------------------------------------------------ #

criterion_router = APIRouter(
    prefix="/api/projects/{project_id}/criteria/{criterion_id}",
    tags=["calibration_examples"],
)


@criterion_router.get("/calibration-examples", response_model=CalibrationExamplesResponse)
def list_examples(
    project_id: int,
    criterion_id: int,
    _: dict = Depends(get_current_user),
) -> CalibrationExamplesResponse:
    """List calibration examples for one criterion (active and inactive)."""
    try:
        examples = CalibrationService().list_for_criterion(project_id, criterion_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return CalibrationExamplesResponse(
        project_id=project_id,
        criterion_id=criterion_id,
        examples=[CalibrationExampleItem(**e) for e in examples],
    )


@criterion_router.post(
    "/calibration-examples/generate",
    response_model=CalibrationExamplesResponse,
)
def generate_examples(
    project_id: int,
    criterion_id: int,
    body: CalibrationExampleGenerateRequest,
    current_user: dict = Depends(get_current_user),
) -> CalibrationExamplesResponse:
    """Select diverse human-scored apps and synthesize reasoning via the LLM.

    Atomically replaces any existing examples for this criterion.
    Synchronous — synthesis usually takes a few seconds per example.
    """
    service = CalibrationService()
    try:
        examples = service.generate(
            project_id, criterion_id, body.max_examples, int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return CalibrationExamplesResponse(
        project_id=project_id,
        criterion_id=criterion_id,
        examples=[CalibrationExampleItem(**e) for e in examples],
    )


# ------------------------------------------------------------------ #
# Per-example active toggle                                          #
# ------------------------------------------------------------------ #

example_router = APIRouter(prefix="/api/calibration-examples", tags=["calibration_examples"])


@example_router.patch("/{example_id}", status_code=204)
def set_active(
    example_id: int,
    body: CalibrationExampleSetActiveRequest,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Activate or deactivate one example. Inactive examples are not injected into prompts."""
    CalibrationService().set_active(example_id, body.is_active, int(current_user["sub"]))
