"""FastAPI application entry point."""

import logging
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# Ensure schema exists (idempotent — CREATE IF NOT EXISTS).
from database import init_db
init_db()

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api.auth import get_current_user
from api.routes import (
    audit_router,
    auth_router,
    calibration_criterion_router,
    calibration_example_router,
    dashboard_router,
    dataset_router,
    demo_router,
    disagreements_iteration_router,
    disagreements_project_router,
    iterations_router,
    locked_prompts_lock_router,
    locked_prompts_library_router,
    metrics_baseline_router,
    metrics_iteration_router,
    programs_router,
    projects_router,
    rubric_router,
    scoring_submit_router,
    scoring_list_router,
    scoring_job_router,
    splits_router,
    users_router,
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("scoring_ai")

app = FastAPI(
    title="Calibrate AI API",
    description="API for calibrating LLM scoring against human evaluators",
    version="2.0.0",
)

# CORS for the Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent.parent / "static"

# /api/auth/* is public (login). /api/auth/me requires auth via per-endpoint Depends.
app.include_router(auth_router)

# Everything else requires a valid JWT.
protected = [Depends(get_current_user)]
app.include_router(dashboard_router, dependencies=protected)
app.include_router(programs_router, dependencies=protected)
app.include_router(projects_router, dependencies=protected)
app.include_router(rubric_router, dependencies=protected)
app.include_router(dataset_router, dependencies=protected)
app.include_router(splits_router, dependencies=protected)
app.include_router(iterations_router, dependencies=protected)
app.include_router(scoring_submit_router, dependencies=protected)
app.include_router(scoring_list_router, dependencies=protected)
app.include_router(scoring_job_router, dependencies=protected)
app.include_router(metrics_baseline_router, dependencies=protected)
app.include_router(metrics_iteration_router, dependencies=protected)
app.include_router(disagreements_iteration_router, dependencies=protected)
app.include_router(disagreements_project_router, dependencies=protected)
app.include_router(audit_router, dependencies=protected)
app.include_router(demo_router, dependencies=protected)
app.include_router(calibration_criterion_router, dependencies=protected)
app.include_router(calibration_example_router, dependencies=protected)
app.include_router(locked_prompts_lock_router, dependencies=protected)
app.include_router(locked_prompts_library_router, dependencies=protected)
app.include_router(users_router, dependencies=protected)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log request method, path, status, and timing."""
    start = time.time()
    response = await call_next(request)
    elapsed_ms = (time.time() - start) * 1000
    logger.info(
        "%s %s -> %d (%.0fms)",
        request.method, request.url.path, response.status_code, elapsed_ms,
    )
    return response


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.get("/")
def root():
    """Serve the SPA index if a build exists, otherwise an API banner."""
    if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
        return FileResponse(STATIC_DIR / "index.html")
    return {
        "name": "Calibrate AI API",
        "version": "2.0.0",
        "docs": "/docs",
    }


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        """Catch-all for SPA client routing — serve any file in static, else fall back to index.html."""
        file_path = STATIC_DIR / full_path
        if file_path.exists() and file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(STATIC_DIR / "index.html")
