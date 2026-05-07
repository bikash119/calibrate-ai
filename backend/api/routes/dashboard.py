"""Dashboard API — top-level aggregate stats."""

import logging

from fastapi import APIRouter, Depends

from api.auth import get_current_user
from api.schemas import DashboardStatsResponse
from api.services.dashboard_service import DashboardService

logger = logging.getLogger("scoring_ai.routes.dashboard")

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStatsResponse)
def get_stats(_: dict = Depends(get_current_user)) -> DashboardStatsResponse:
    """Return dashboard headline stats (projects-by-state, programs, locked-prompts)."""
    return DashboardStatsResponse(**DashboardService().stats())
