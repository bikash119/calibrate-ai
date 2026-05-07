---
name: backend
description: Backend API development patterns for Scoring AI — FastAPI routes, SQLite repositories, Pydantic schemas, service layer conventions. Use before writing any backend code.
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# Backend Development Skill

You are implementing backend features for the Scoring AI platform — a FastAPI + SQLite application. Follow these patterns exactly. Do not invent new patterns.

## Architecture Layers

Every backend feature touches three layers in this order:

1. **Data layer** (`database.py` schema + `db_models.py` repository)
2. **Service layer** (`api/services/*.py`) — business logic, never in routes
3. **API layer** (`api/routes/*.py` + `api/schemas.py`) — thin, delegates to services/repositories

## Data Model Map (17 tables)

Reference this before adding any new feature. Never duplicate a concept that already has a table.

| Concern | Tables |
|---------|--------|
| Identity | `users`, `audit_log` |
| Org | `programs`, `projects` |
| Rubric (1:1 project) | `criteria` |
| Dataset (1:1 project) | `questions`, `applications`, `human_scores` |
| Calibration loop | `splits`, `iterations`, `iteration_prompts` |
| Scoring | `scoring_jobs`, `llm_scores` |
| Analysis | `agreement_metrics`, `disagreement_flags`, `calibration_examples` |
| Output | `locked_prompts` |

Key relationships:
- A **project** owns exactly one rubric (its `criteria` rows) and one dataset (its `questions`, `applications`, `human_scores` rows). Cascade-deleted with the project.
- An **iteration** is a versioned prompt set within a project. Owns one `iteration_prompts` row per criterion.
- A **scoring_job** is one async run (batch / sequential / single). Owns its `llm_scores`.
- An **agreement_metrics** row covers BOTH H-H baseline (iteration_id NULL) AND LLM-H per iteration. One generic table — new metric types = new rows, no schema changes.
- A **locked_prompt** snapshots rubric, prompts, and metrics into JSON. Survives project deletion.

## Data Model Invariants

These rules are non-negotiable. Violating them creates schema drift and silent bugs.

1. **No derived data on disk.** Median human scores, score comparisons (`higher`/`lower`/`match`), totals, agreement summaries — all computed on read. Never store.
2. **Score scale is per-criterion.** Every criterion has `scale_min` and `scale_max`. Never hardcode 1-3, 1-5, or any literal scale.
3. **One source of truth per concept.** Prompts live in `iteration_prompts`. Scoring runs in `scoring_jobs`. Scores in `llm_scores`. No parallel tables.
4. **Audit log is generic.** Use `audit_log.entity_type` + `entity_id`, not typed FKs. Adding a typed `project_id` column to audit_log is wrong.
5. **Locked prompts are immutable artifacts.** Snapshot rubric/prompts/metrics into JSON columns. `project_id` FK is `ON DELETE SET NULL` so the artifact survives.
6. **Cascade discipline.** `ON DELETE CASCADE` for anything owned by a project. `ON DELETE RESTRICT` on `projects.program_id` (prevent nuking live projects). `ON DELETE SET NULL` on user FKs in audit/locked artifacts.
7. **Splits are reproducible.** Derived from `projects.random_seed` + the application set. Never insert split rows by hand.

## Database (SQLite)

### Schema changes (`database.py`)

Add new tables to the `SCHEMA` string. Follow these conventions exactly:

```sql
CREATE TABLE IF NOT EXISTS table_name (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- FKs ALWAYS specify ON DELETE policy
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- CHECK constraints for enums
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
    -- JSON stored as TEXT, suffix `_json`
    metadata_json TEXT,
    -- ISO 8601 timestamps stored as TEXT (SQLite has no native datetime)
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_table_name_project ON table_name(project_id);
```

Rules:
- Always use `CREATE TABLE IF NOT EXISTS` (idempotent schema)
- Always include `id INTEGER PRIMARY KEY AUTOINCREMENT` unless the natural PK is composite (e.g., `iteration_prompts (iteration_id, criterion_id)`)
- Use `TEXT` for JSON columns, suffix with `_json`
- Use `TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP` for timestamps — never `TIMESTAMP` (SQLite stores text either way; this is honest about it)
- Use `CHECK` constraints for enum columns, not application-level validation
- Every FK MUST specify `ON DELETE CASCADE | RESTRICT | SET NULL`
- Add indexes after the table definition; index every FK and any frequently-filtered column
- After adding a table, also add it to `_TABLES_DROP_ORDER` in `database.py` (children before parents)

### Connection pattern (`database.py`)

Always use the context manager. Never create raw connections:

```python
from database import get_db_cursor

with get_db_cursor() as cursor:
    cursor.execute("SELECT ... WHERE id = ?", (id,))
    row = cursor.fetchone()
```

- Use `?` placeholders, never f-strings for SQL values
- Use `cursor.fetchone()` for single rows, `cursor.fetchall()` for lists
- The context manager auto-commits on success, rollbacks on exception

### Repository classes (`db_models.py`)

Every table gets a repository class. Follow this exact pattern:

```python
@dataclass
class Project:
    """A calibration project — owns one rubric and one dataset."""
    id: int | None = None
    program_id: int = 0
    name: str = ""
    description: str | None = None
    language: str | None = None
    state: str = "setup"
    random_seed: int = 0
    cloned_from_id: int | None = None
    created_by: int | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProjectRepository:
    """Data access for the projects table."""

    def get_by_id(self, project_id: int) -> Project | None:
        with get_db_cursor() as cursor:
            cursor.execute("SELECT * FROM projects WHERE id = ?", (project_id,))
            row = cursor.fetchone()
            if not row:
                return None
            return Project(**dict(row))

    def get_all(self, program_id: int | None = None) -> list[Project]:
        with get_db_cursor() as cursor:
            if program_id:
                cursor.execute("SELECT * FROM projects WHERE program_id = ? ORDER BY created_at DESC", (program_id,))
            else:
                cursor.execute("SELECT * FROM projects ORDER BY created_at DESC")
            return [Project(**dict(row)) for row in cursor.fetchall()]

    def create(self, project: Project) -> int:
        with get_db_cursor() as cursor:
            cursor.execute(
                "INSERT INTO projects (program_id, name, state) VALUES (?, ?, ?)",
                (project.program_id, project.name, project.state),
            )
            return cursor.lastrowid

    def update_state(self, project_id: int, new_state: str) -> None:
        with get_db_cursor() as cursor:
            cursor.execute(
                "UPDATE projects SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (new_state, project_id),
            )
```

Rules:
- Dataclass for the entity, Repository class for data access
- All fields have defaults (so `Project(**dict(row))` always works for any SELECT *)
- Field names match column names exactly — that's how `Project(**dict(row))` hydrates
- Use `int | None` / `str | None` for optional fields, not `Optional[int]`
- Timestamps are `str | None` (TEXT columns, ISO 8601), not `datetime`
- Repository methods are stateless — no `db_path` parameter, no `__init__` storing state. Always call module-level `get_db_cursor()`.
- Return dataclass instances, never raw `sqlite3.Row`
- `create()` returns `int` (the new ID via `cursor.lastrowid`)
- `get_by_id()` returns `Entity | None`
- `get_all()` returns `list[Entity]`
- Computed/derived data (counts, medians, comparisons) lives in service-layer methods, NOT in repositories. Repositories return raw rows; services compose.

## Services (`api/services/*.py`)

Services contain business logic. Routes never contain logic.

```python
"""Project lifecycle service."""

import logging
from db_models import ProjectRepository, AuditLogRepository

logger = logging.getLogger("scoring_ai.services.project")

# Valid state transitions (current_state -> allowed_next_states)
VALID_TRANSITIONS = {
    "setup": ["baseline_computed"],
    "baseline_computed": ["iterating"],
    "iterating": ["test_run_complete"],
    "test_run_complete": ["locked", "abandoned"],
}


class ProjectService:
    """Orchestrates project lifecycle operations."""

    def __init__(self):
        self.repo = ProjectRepository()
        self.audit = AuditLogRepository()

    def transition_state(self, project_id: int, new_state: str, user_id: int) -> None:
        project = self.repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")

        allowed = VALID_TRANSITIONS.get(project.state, [])
        if new_state not in allowed:
            raise ValueError(
                f"Cannot transition from '{project.state}' to '{new_state}'. "
                f"Allowed: {allowed}"
            )

        self.repo.update_state(project_id, new_state)
        self.audit.log(project_id, user_id, "state_transition", {
            "from": project.state,
            "to": new_state,
        })
        logger.info("Project %d: %s -> %s (user %d)", project_id, project.state, new_state, user_id)
```

Rules:
- One service file per domain (project, upload, statistics, iteration)
- Services instantiate their own repositories in `__init__`
- Raise `ValueError` for business rule violations (routes translate to HTTP 400/409)
- Use `logging.getLogger("scoring_ai.services.<name>")` — never `print()`
- Services never import FastAPI types (no `HTTPException`, no `Request`)

## API Routes (`api/routes/*.py`)

### Route file structure

```python
"""Projects API endpoints."""

from fastapi import APIRouter, HTTPException, Depends, Query

from api.auth import get_current_user, require_admin
from api.schemas import ProjectResponse, ProjectCreateRequest, ProjectsListResponse
from api.services.project_service import ProjectService

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=ProjectsListResponse)
def list_projects(
    state: str | None = Query(None),
    current_user: dict = Depends(get_current_user),
) -> ProjectsListResponse:
    """List all projects, optionally filtered by state."""
    service = ProjectService()
    projects = service.list_projects(state=state)
    return ProjectsListResponse(projects=[...])


@router.post("", response_model=ProjectResponse, status_code=201)
def create_project(
    body: ProjectCreateRequest,
    current_user: dict = Depends(require_admin),
) -> ProjectResponse:
    """Create a new project."""
    service = ProjectService()
    try:
        project_id = service.create_project(body.name, body.program_id, int(current_user["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return ProjectResponse(id=project_id, ...)
```

Rules:
- One router per domain, prefix is `/api/<domain>`
- `tags=["domain"]` for OpenAPI grouping
- Routes are thin: validate input, call service, map output
- Use `Depends(get_current_user)` for auth, `Depends(require_admin)` for admin-only
- `current_user` is a dict with keys: `sub` (user ID string), `username`, `role`
- Convert `ValueError` from services to `HTTPException(400)`
- Convert "not found" to `HTTPException(404)`
- Always set `response_model` on the decorator
- Use `Query()` for query params, Pydantic models for request bodies

### Registering routes

After creating a new route file, register it in two places:

1. `api/routes/__init__.py` — add the import and `__all__` entry
2. `api/main.py` — add `app.include_router(new_router, dependencies=[Depends(get_current_user)])`

## Pydantic Schemas (`api/schemas.py`)

```python
class ProjectCreateRequest(BaseModel):
    """Request body for POST /api/projects."""
    name: str
    program_id: int
    description: str | None = None
    language: str | None = None


class ProjectItem(BaseModel):
    """Single project in a list. Counts/metrics are server-computed, never stored."""
    id: int
    program_id: int
    name: str
    description: str | None
    state: str
    application_count: int           # COUNT(applications) — derived
    iteration_count: int             # COUNT(iterations) — derived
    latest_dev_qwk: float | None     # latest dev-split QWK from agreement_metrics — derived
    updated_at: str


class ProjectsListResponse(BaseModel):
    """Response for GET /api/projects."""
    projects: list[ProjectItem]
```

Rules:
- Request models end with `Request`, response models end with `Response`, list items end with `Item`
- All schemas in one file (`api/schemas.py`) — don't split
- Use `str` for timestamps (ISO 8601), not `datetime`
- Use `int | None` for optional fields
- Derived/computed fields (counts, latest metrics, medians) ARE allowed in response schemas — they come from service-layer aggregation, never from a stored column. Add a comment noting `// derived` so it's obvious.
- Add a docstring that says which endpoint uses it

## Authentication

- Public endpoints: only `/api/auth/login`
- All other endpoints require `Depends(get_current_user)`
- Admin-only operations use `Depends(require_admin)` per-endpoint
- Access `current_user["sub"]` for user ID (it's a string, cast to `int` when needed)
- Access `current_user["role"]` for role checks

## Error Handling

- **400**: business rule violations (from `ValueError` in services)
- **401**: missing or invalid JWT (handled by `get_current_user`)
- **403**: non-admin accessing admin endpoint (handled by `require_admin`)
- **404**: entity not found
- **409**: conflict (e.g., duplicate name, invalid state transition)

Never return 500 intentionally. Let unhandled exceptions propagate — FastAPI returns 500 automatically with the traceback in dev mode.

## Logging

```python
import logging
logger = logging.getLogger("scoring_ai.<module_name>")

# In functions:
logger.info("Scored application %d on criterion %d: %d", app_id, criterion_id, score)
logger.warning("Low confidence extraction for column %s: %.2f", col_name, confidence)
logger.error("Failed to parse rubric file: %s", str(e))
```

- Always use `scoring_ai.<module_name>` as the logger name
- Use `%s`/`%d` formatting (lazy), never f-strings in log calls
- Log at INFO for normal operations, WARNING for recoverable issues, ERROR for failures

## LLM Calls

**All LLM calls go through `llm_client.py`.** Never import `anthropic` or `google.genai` directly.

```python
from llm_client import get_llm_client

client = get_llm_client()
result = client.generate(system_prompt="...", user_prompt="...")
# or
result = client.score(system_prompt="...", user_prompt="...", expected_schema=...)
```

## File Organization

```
calibrate-ai/
├── database.py             # SQLite connection + SCHEMA + init_db / reset_db
├── db_models.py            # All dataclasses + repositories (one file)
├── db_seed.py              # First-run seed (default program, admin user)
├── llm_client.py           # The ONLY place LLM SDKs are imported
├── prompts.py              # Shared prompt-building utilities
├── api/
│   ├── main.py             # FastAPI app, CORS, router registration
│   ├── auth.py             # JWT helpers, get_current_user, require_admin
│   ├── schemas.py          # All Pydantic request/response models
│   ├── routes/             # One router per domain
│   └── services/           # One service per domain (business logic)
└── frontend/               # React + TypeScript + Vite
```

Rules:
- New top-level Python files at the repo root require a strong reason. Default: extend an existing module.
- `db_models.py` is one file — do NOT split into `db_models/users.py`, etc. Single import path is part of the convention.
- Anything in `api/services/` may import from `db_models`; reverse is forbidden.

## Checklist for Every Backend Feature

1. [ ] Cross-checked against **Data Model Invariants** above (no derived data stored, no hardcoded scale, etc.)
2. [ ] Schema added to `database.py` SCHEMA string (if new table) — with `ON DELETE` policies on every FK
3. [ ] If new table, also added to `_TABLES_DROP_ORDER` in `database.py`
4. [ ] Dataclass + Repository in `db_models.py` — fields match column names, all defaults present
5. [ ] Service class in `api/services/` — business logic, never in routes
6. [ ] Pydantic schemas in `api/schemas.py` — derived fields commented as such
7. [ ] Route file in `api/routes/`
8. [ ] Route registered in `api/routes/__init__.py` and `api/main.py`
9. [ ] Tested via `curl` or the FastAPI docs UI at `/docs`
