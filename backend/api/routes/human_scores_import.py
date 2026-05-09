"""Human-score upload — file parse for the wide-format wizard.

Wide CSVs and XLSX files often have multi-row headers (e.g. a category row
above the real evaluator_criterion headers). This endpoint returns the file
as a 2D grid so the wizard can let the operator pick which row is the
header. The actual upload still goes through the existing JSON-shaped
`POST /human-scores` endpoint after the client pivots to long form.
"""

import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from api.auth import get_current_user
from api.schemas import (
    ImportPreviewResponse,
    ImportPreviewSheet,
    ImportSheetInfo,
)
from api.services.import_service import ImportError, parse_to_grid
from db_models import ProjectRepository

logger = logging.getLogger("scoring_ai.routes.human_scores_import")

router = APIRouter(
    prefix="/api/projects/{project_id}/human-scores",
    tags=["human-scores"],
)


@router.post("/parse", response_model=ImportPreviewResponse)
async def parse_human_score_upload(
    project_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
) -> ImportPreviewResponse:
    """Parse a CSV/XLSX upload and return a 2D-grid preview for the wizard.

    Same response shape as `/dataset/parse`. Gated to projects in 'setup'
    state — once splits are created the project is locked and human scores
    can no longer be added.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")

    project = ProjectRepository().get_by_id(project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {project_id} not found")
    if project.state != "setup":
        raise HTTPException(
            status_code=409,
            detail=(
                f"Human-score upload is only allowed in 'setup' state "
                f"(current: '{project.state}'). Clone the project to start over."
            ),
        )

    file_bytes = await file.read()
    try:
        # full_rows=True: the wide-format wizard pivots client-side, so we
        # need every row, not just a preview.
        result = parse_to_grid(file_bytes, file.filename, full_rows=True)
    except ImportError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return ImportPreviewResponse(
        format=result["format"],
        sheets=[ImportSheetInfo(**s) for s in result["sheets"]],
        suggested_sheet=result["suggested_sheet"],
        preview=ImportPreviewSheet(**result["preview"]),
    )


__all__ = ["router"]
