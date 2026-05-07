"""Projects API — calibration project lifecycle."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from api.auth import get_current_user, require_admin
from api.schemas import (
    ProjectCloneRequest,
    ProjectCreateRequest,
    ProjectDetailResponse,
    ProjectItem,
    ProjectTransitionRequest,
    ProjectUpdateRequest,
    ProjectsListResponse,
)
from api.services.project_service import ProjectService

logger = logging.getLogger("scoring_ai.routes.projects")

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectsListResponse)
def list_projects(
    program_id: int | None = Query(None),
    state: str | None = Query(None),
    _: dict = Depends(get_current_user),
) -> ProjectsListResponse:
    """List projects with derived counts and headline metrics."""
    rows = ProjectService().list_with_derived(program_id=program_id, state=state)
    return ProjectsListResponse(projects=[ProjectItem(**r) for r in rows])


@router.post("", response_model=ProjectDetailResponse, status_code=201)
def create_project(
    body: ProjectCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Create a new project under a program."""
    service = ProjectService()
    try:
        project_id = service.create(
            body.program_id, body.name, body.description, body.language,
            int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectDetailResponse(**service.get_detail(project_id))


@router.get("/{project_id}", response_model=ProjectDetailResponse)
def get_project(
    project_id: int,
    _: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Fetch a single project with derived counts."""
    try:
        return ProjectDetailResponse(**ProjectService().get_detail(project_id))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.patch("/{project_id}", response_model=ProjectDetailResponse)
def update_project(
    project_id: int,
    body: ProjectUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Update project name / description / language."""
    service = ProjectService()
    try:
        service.update_metadata(
            project_id, body.name, body.description, body.language,
            int(current_user["sub"]),
        )
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectDetailResponse(**service.get_detail(project_id))


@router.post("/{project_id}/transition", response_model=ProjectDetailResponse)
def transition_project(
    project_id: int,
    body: ProjectTransitionRequest,
    current_user: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Advance the project state machine. Invalid transitions return 409."""
    service = ProjectService()
    try:
        service.transition_state(project_id, body.new_state, int(current_user["sub"]))
    except ValueError as e:
        msg = str(e).lower()
        if "not found" in msg:
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=409, detail=str(e))
    return ProjectDetailResponse(**service.get_detail(project_id))


@router.post("/{project_id}/clone", response_model=ProjectDetailResponse, status_code=201)
def clone_project(
    project_id: int,
    body: ProjectCloneRequest,
    current_user: dict = Depends(get_current_user),
) -> ProjectDetailResponse:
    """Clone a project (rubric + dataset + human scores). Resets state to 'setup'."""
    service = ProjectService()
    try:
        new_id = service.clone(project_id, body.name, int(current_user["sub"]))
    except ValueError as e:
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectDetailResponse(**service.get_detail(new_id))


@router.delete("/{project_id}", status_code=204)
def delete_project(
    project_id: int,
    current_user: dict = Depends(require_admin),
) -> None:
    """Delete a project and all its data (admin only)."""
    try:
        ProjectService().delete(project_id, int(current_user["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
