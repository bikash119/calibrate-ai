"""Dataset API — questions, applications, human scores. Nested under /api/projects/{id}."""

import logging

from fastapi import APIRouter, Body, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import (
    ApplicationDetail,
    ApplicationItem,
    ApplicationsResponse,
    HumanScoreItem,
    HumanScoreMedianItem,
    HumanScoresResponse,
    QuestionItem,
    QuestionsResponse,
    QuestionsSaveRequest,
)
from api.services.dataset_service import DatasetService

logger = logging.getLogger("scoring_ai.routes.dataset")

router = APIRouter(prefix="/api/projects/{project_id}", tags=["dataset"])


# ------------------------------------------------------------------ #
# Questions                                                          #
# ------------------------------------------------------------------ #


@router.get("/questions", response_model=QuestionsResponse)
def list_questions(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> QuestionsResponse:
    """List the question schema for this project's dataset."""
    try:
        questions = DatasetService().get_questions(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return QuestionsResponse(
        project_id=project_id,
        questions=[QuestionItem(id=q.id, key=q.key, text=q.text, sort_order=q.sort_order) for q in questions],
    )


@router.put("/questions", response_model=QuestionsResponse)
def save_questions(
    project_id: int,
    body: QuestionsSaveRequest,
    current_user: dict = Depends(get_current_user),
) -> QuestionsResponse:
    """Atomically replace the question schema for this project."""
    service = DatasetService()
    try:
        service.save_questions(
            project_id,
            [q.model_dump() for q in body.questions],
            int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    questions = service.get_questions(project_id)
    return QuestionsResponse(
        project_id=project_id,
        questions=[QuestionItem(id=q.id, key=q.key, text=q.text, sort_order=q.sort_order) for q in questions],
    )


# ------------------------------------------------------------------ #
# Applications                                                       #
# ------------------------------------------------------------------ #


@router.get("/applications", response_model=ApplicationsResponse)
def list_applications(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> ApplicationsResponse:
    """List applications in this project (no answers; for index views)."""
    try:
        apps = DatasetService().list_applications(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return ApplicationsResponse(
        project_id=project_id,
        applications=[ApplicationItem(**a) for a in apps],
    )


@router.get("/applications/{application_id}", response_model=ApplicationDetail)
def get_application(
    project_id: int,
    application_id: int,
    _: dict = Depends(get_current_user),
) -> ApplicationDetail:
    """Fetch one application with its full answers payload."""
    try:
        return ApplicationDetail(**DatasetService().get_application(project_id, application_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.post("/applications", status_code=201)
def upsert_applications(
    project_id: int,
    applications: list[dict] = Body(..., embed=True),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-insert applications. Each item: {external_id, answers, metadata?}."""
    try:
        n = DatasetService().upsert_applications(
            project_id, applications, int(current_user["sub"])
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return {"loaded": n}


# ------------------------------------------------------------------ #
# Human scores                                                       #
# ------------------------------------------------------------------ #


@router.get("/human-scores", response_model=HumanScoresResponse)
def list_human_scores(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> HumanScoresResponse:
    """List all human scores for this project (one row per evaluator × app × criterion)."""
    try:
        scores = DatasetService().list_human_scores(project_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return HumanScoresResponse(
        project_id=project_id,
        scores=[
            HumanScoreItem(
                id=hs.id,
                application_id=hs.application_id,
                criterion_id=hs.criterion_id,
                evaluator_id=hs.evaluator_id,
                score=hs.score,
                created_at=hs.created_at,
            ) for hs in scores
        ],
    )


@router.post("/human-scores", status_code=201)
def upsert_human_scores(
    project_id: int,
    scores: list[dict] = Body(..., embed=True),
    current_user: dict = Depends(get_current_user),
) -> dict:
    """Bulk-insert human scores. Each item: {external_id, criterion_name, evaluator_id, score}."""
    try:
        n = DatasetService().upsert_human_scores(
            project_id, scores, int(current_user["sub"])
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return {"loaded": n}


@router.get("/criteria/{criterion_id}/medians", response_model=list[HumanScoreMedianItem])
def get_medians(
    project_id: int,
    criterion_id: int,
    _: dict = Depends(get_current_user),
) -> list[HumanScoreMedianItem]:
    """Server-derived medians per application for one criterion."""
    try:
        rows = DatasetService().medians_for_criterion(project_id, criterion_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return [HumanScoreMedianItem(**r) for r in rows]
