"""Programs API — top-level org grouping for projects."""

import logging

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user, require_admin
from api.schemas import (
    ProgramCreateRequest,
    ProgramItem,
    ProgramUpdateRequest,
    ProgramsListResponse,
)
from api.services.program_service import ProgramService

logger = logging.getLogger("scoring_ai.routes.programs")

router = APIRouter(prefix="/api/programs", tags=["programs"])


@router.get("", response_model=ProgramsListResponse)
def list_programs(_: dict = Depends(get_current_user)) -> ProgramsListResponse:
    """List all programs with derived project counts."""
    rows = ProgramService().list_with_counts()
    return ProgramsListResponse(programs=[ProgramItem(**r) for r in rows])


@router.post("", response_model=ProgramItem, status_code=201)
def create_program(
    body: ProgramCreateRequest,
    current_user: dict = Depends(require_admin),
) -> ProgramItem:
    """Create a new program (admin only)."""
    service = ProgramService()
    try:
        program_id = service.create(body.name, body.description, int(current_user["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Re-fetch with counts for the response
    rows = service.list_with_counts()
    item = next((r for r in rows if r["id"] == program_id), None)
    if not item:
        raise HTTPException(status_code=500, detail="Created program could not be loaded")
    return ProgramItem(**item)


@router.put("/{program_id}", response_model=ProgramItem)
def update_program(
    program_id: int,
    body: ProgramUpdateRequest,
    current_user: dict = Depends(require_admin),
) -> ProgramItem:
    """Rename / re-describe a program (admin only)."""
    service = ProgramService()
    try:
        service.update(program_id, body.name, body.description, int(current_user["sub"]))
    except ValueError as e:
        # Distinguish not-found from validation errors
        if "not found" in str(e).lower():
            raise HTTPException(status_code=404, detail=str(e))
        raise HTTPException(status_code=400, detail=str(e))
    rows = service.list_with_counts()
    item = next((r for r in rows if r["id"] == program_id), None)
    if not item:
        raise HTTPException(status_code=404, detail=f"Program {program_id} not found")
    return ProgramItem(**item)


@router.delete("/{program_id}", status_code=204)
def delete_program(
    program_id: int,
    current_user: dict = Depends(require_admin),
) -> None:
    """Delete a program. Fails if it has any projects (admin only)."""
    try:
        ProgramService().delete(program_id, int(current_user["sub"]))
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        raise HTTPException(status_code=409, detail=msg)
