"""API route modules."""

from .audit import router as audit_router
from .auth import router as auth_router
from .calibration import (
    criterion_router as calibration_criterion_router,
    example_router as calibration_example_router,
)
from .dashboard import router as dashboard_router
from .dataset import router as dataset_router
from .demo import router as demo_router
from .disagreements import (
    iteration_router as disagreements_iteration_router,
    project_router as disagreements_project_router,
)
from .iterations import router as iterations_router
from .locked_prompts import (
    lock_router as locked_prompts_lock_router,
    library_router as locked_prompts_library_router,
)
from .metrics import (
    baseline_router as metrics_baseline_router,
    iteration_router as metrics_iteration_router,
)
from .programs import router as programs_router
from .projects import router as projects_router
from .rubric import router as rubric_router
from .scoring_jobs import (
    submit_router as scoring_submit_router,
    list_router as scoring_list_router,
    job_router as scoring_job_router,
)
from .splits import router as splits_router
from .users import router as users_router

__all__ = [
    "audit_router",
    "auth_router",
    "calibration_criterion_router",
    "calibration_example_router",
    "dashboard_router",
    "dataset_router",
    "demo_router",
    "disagreements_iteration_router",
    "disagreements_project_router",
    "iterations_router",
    "locked_prompts_lock_router",
    "locked_prompts_library_router",
    "metrics_baseline_router",
    "metrics_iteration_router",
    "programs_router",
    "projects_router",
    "rubric_router",
    "scoring_submit_router",
    "scoring_list_router",
    "scoring_job_router",
    "splits_router",
    "users_router",
]
