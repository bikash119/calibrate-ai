"""Rubric API — nested under /api/projects/{id}/rubric."""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.auth import get_current_user
from api.schemas import (
    CriterionItem,
    ExtractedCriterion,
    PromptPreviewResponse,
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
from db_models import (
    ApplicationRepository,
    CriteriaRepository,
    QuestionRepository,
)
from prompts import build_system_prompt, build_user_prompt

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
    questions = QuestionRepository().get_by_project(project_id)
    try:
        criteria = RubricExtractionService().extract_from_text(
            body.text, questions=questions,
        )
    except RubricExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RubricExtractResponse(
        criteria=[ExtractedCriterion(**c) for c in criteria],
    )


# ------------------------------------------------------------------ #
# Prompt preview — debug aid: renders the actual system + user prompt
# that real scoring would build for a (criterion, application) pair.
# ------------------------------------------------------------------ #


@router.get(
    "/criteria/{criterion_id}/prompt-preview",
    response_model=PromptPreviewResponse,
)
def preview_criterion_prompt(
    project_id: int,
    criterion_id: int,
    application_id: int | None = None,
    _: dict = Depends(get_current_user),
) -> PromptPreviewResponse:
    """Render the would-be LLM prompts for a (criterion, application) pair.

    Without `application_id`, picks the project's first application. With no
    applications imported, returns the system prompt and a null user prompt.
    """
    criterion = CriteriaRepository().get_by_id(criterion_id)
    if not criterion or criterion.project_id != project_id:
        raise HTTPException(status_code=404, detail="Criterion not found in project")

    questions = QuestionRepository().get_by_project(project_id)
    questions_by_key = {q.key: q for q in questions}

    app_repo = ApplicationRepository()
    application = None
    if application_id is not None:
        application = app_repo.get_by_id(application_id)
        if not application or application.project_id != project_id:
            raise HTTPException(
                status_code=404, detail="Application not found in project",
            )
    else:
        apps = app_repo.get_by_project(project_id)
        application = apps[0] if apps else None

    system_prompt = build_system_prompt(criterion)
    user_prompt = (
        build_user_prompt(criterion, application, questions_by_key)
        if application
        else None
    )

    return PromptPreviewResponse(
        criterion_id=criterion.id,
        criterion_name=criterion.name,
        application_id=application.id if application else None,
        application_external_id=application.external_id if application else None,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
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
    questions = QuestionRepository().get_by_project(project_id)
    try:
        criteria = RubricExtractionService().extract_from_file(
            file_bytes, file.filename, questions=questions,
        )
    except RubricExtractionError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return RubricExtractResponse(
        criteria=[ExtractedCriterion(**c) for c in criteria],
    )
