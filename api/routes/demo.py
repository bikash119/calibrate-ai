"""Demo project bootstrap — one click to a fully-populated project."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from api.schemas import ProjectDetailResponse
from api.services.demo_service import DemoService
from api.services.project_service import ProjectService

logger = logging.getLogger("scoring_ai.routes.demo")

router = APIRouter(prefix="/api/demo", tags=["demo"])


@router.post("/project", response_model=ProjectDetailResponse, status_code=201)
def create_demo_project(
    program_id: int = 1,
    current_user: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Create a fully-populated demo project under the given program (default 1)."""
    user_id = int(current_user["sub"])
    try:
        new_id = DemoService().create_demo_project(program_id, user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectDetailResponse(**ProjectService().get_detail(new_id))
