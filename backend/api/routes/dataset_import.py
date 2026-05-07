"""Dataset import — CSV/XLSX preview + atomic replace.

The dataset upload + parse path expects multipart/form-data because we're
sending a file. Mappings travel as a JSON form field next to the file.
"""

import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.auth import get_current_user
from api.schemas import (
    ColumnMapping,
    ImportPreviewResponse,
    ImportPreviewSheet,
    ImportRequest,
    ImportResponse,
    ImportSheetInfo,
)
from api.services.import_service import ImportError, ImportService

logger = logging.getLogger("scoring_ai.routes.dataset_import")

router = APIRouter(prefix="/api/projects/{project_id}/dataset", tags=["dataset"])


@router.post("/parse", response_model=ImportPreviewResponse)
async def parse_upload(
    project_id: int,
    file: UploadFile = File(...),
    _: dict = Depends(get_current_user),
) -> ImportPreviewResponse:
    """Parse a CSV/XLSX upload and return preview metadata for the wizard."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    file_bytes = await file.read()
    try:
        result = ImportService().parse(project_id, file_bytes, file.filename)
    except ImportError as e:
        raise HTTPException(
            status_code=409 if "must be in 'setup' state" in str(e) else 400,
            detail=str(e),
        )
    return ImportPreviewResponse(
        format=result["format"],
        sheets=[ImportSheetInfo(**s) for s in result["sheets"]],
        suggested_sheet=result["suggested_sheet"],
        preview=ImportPreviewSheet(**result["preview"]),
    )


@router.post("/import", response_model=ImportResponse, status_code=201)
async def import_dataset(
    project_id: int,
    file: UploadFile = File(...),
    mappings: str = Form(..., description="JSON-encoded ImportRequest body"),
    current_user: dict = Depends(get_current_user),
) -> ImportResponse:
    """Atomically replace the project's questions + applications.

    `mappings` arrives as a JSON-encoded string in a multipart form field
    (it can't be a JSON body because we're also sending the file). It must
    parse into the ImportRequest shape.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    try:
        parsed = json.loads(mappings)
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=400, detail=f"Invalid mappings JSON: {e}")
    try:
        validated = ImportRequest(**parsed)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid mappings shape: {e}")

    file_bytes = await file.read()

    service = ImportService()
    try:
        result = service.import_dataset(
            project_id=project_id,
            file_bytes=file_bytes,
            filename=file.filename,
            mappings={
                "sheet_name": validated.sheet_name,
                "question_row_index": validated.question_row_index,
                "data_start_row_index": validated.data_start_row_index,
                "column_mappings": [
                    {"column_index": cm.column_index, "role": cm.role}
                    for cm in validated.column_mappings
                ],
            },
            user_id=int(current_user["sub"]),
        )
    except ImportError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=404, detail=msg)
        if "setup" in msg.lower() and "state" in msg.lower():
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=400, detail=msg)

    return ImportResponse(**result)


__all__ = ["router", "ColumnMapping"]
