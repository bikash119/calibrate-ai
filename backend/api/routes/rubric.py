"""Rubric API — nested under /api/projects/{id}/rubric."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.auth import get_current_user
from api.schemas import (
    CriterionInput,
    CriterionItem,
    RubricExtractResponse,
    RubricExtractTextRequest,
    RubricResponse,
    RubricSaveRequest,
)
from api.services.rubric_extraction_service import (
    RubricExtractionError,
    RubricExtractionService,
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


# ------------------------------------------------------------------ #
# Extraction (LLM-driven). Used by the UI's Paste/Upload modes; the
# returned criteria seed the inline editor — operator reviews and then
# saves via PUT /rubric.
# ------------------------------------------------------------------ #


@router.post("/rubric/extract-text", response_model=RubricExtractResponse)
def extract_rubric_from_text(
    project_id: int,
    body: RubricExtractTextRequest,
    _: dict = Depends(get_current_user),
) -> RubricExtractResponse:
    """Extract structured criteria from a pasted rubric blob."""
    try:
        criteria = RubricExtractionService().extract_from_text(body.text)
    except RubricExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RubricExtractResponse(
        criteria=[CriterionInput(**c) for c in criteria],
    )


@router.post("/rubric/extract-file", response_model=RubricExtractResponse)
async def extract_rubric_from_file(
    project_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
) -> RubricExtractResponse:
    """Extract structured criteria from an uploaded .txt / .md / .docx file."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    file_bytes = await file.read()
    try:
        criteria = RubricExtractionService().extract_from_file(
            file_bytes, file.filename,
        )
    except RubricExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RubricExtractResponse(
        criteria=[CriterionInput(**c) for c in criteria],
    )
