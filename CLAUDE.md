# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Calibrate AI is an open-source platform for calibrating LLM-based scoring to match human evaluators. An operator uploads a rubric, a dataset of applications, and per-evaluator human scores; the platform computes a human-human (H-H) agreement baseline, then iterates LLM prompts (auto-generated from the rubric, refined with operator-flagged calibration examples) until LLM-human agreement approaches the H-H ceiling. The final calibrated prompt is locked into an immutable artifact.

The full loop is web-only — there is no CLI.

## Development Skills (Slash Commands)

Use `/backend` and `/frontend` before implementing any feature. These skills (in `.claude/skills/`) define the patterns, file conventions, data invariants, and checklists that keep the codebase coherent.

- **`/backend`** — FastAPI routes, SQLite repositories, Pydantic schemas, service layer; the data-model invariants are listed in the skill (no derived data on disk, scale per-criterion, generic audit log, etc.)
- **`/frontend`** — React 19 + Vite + TypeScript + Tailwind 4; design tokens, React Query hooks, Zod schemas; mirroring frontend invariants

## Development Environment

- **Python:** 3.12 (`.python-version`)
- **Package manager:** uv (`pyproject.toml`, `uv.lock`)
- **Frontend:** React 19 + TypeScript + Vite 7 (in `frontend/`)
- **Database:** SQLite, single file at `SCORING_DB_PATH` (default `./scoring.db`)

## Commands

```bash
# Install backend deps
uv sync

# Initialize the DB (idempotent — creates schema + Default program + admin user)
uv run python db_seed.py
uv run python db_seed.py --reset    # Destructive; drops everything and rebuilds

# Run the API
uvicorn api.main:app --reload --port 8000

# Frontend
cd frontend
npm install
npm run dev      # Vite dev server at :5173, proxies /api to :8000
npm run build    # Production build to frontend/dist/

# Docker (single image; frontend baked into the FastAPI static mount)
docker compose up --build
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `LLM_PROVIDER` | `claude` (default) or `gemini` |
| `ANTHROPIC_API_KEY` | Required when `LLM_PROVIDER=claude` |
| `GOOGLE_API_KEY` | Required for Gemini unless running on Vertex AI with a VM service account |
| `GCP_PROJECT`, `GCP_LOCATION` | Vertex AI batch — not used by sequential scoring |
| `SCORING_DB_PATH` | SQLite file path (default `./scoring.db`) |
| `JWT_SECRET` | JWT signing secret. **Override in production.** |
| `CALIBRATE_ADMIN_USERNAME` | Admin username seeded by `db_seed.py` (default `admin`) |
| `CALIBRATE_ADMIN_PASSWORD` | Admin password seeded by `db_seed.py` (default `admin`) |

## LLM Client Pattern

**All LLM calls go through `llm_client.py`.** `get_llm_client()` returns a client with `score(system, user)` and `generate(system, user)` methods. Never import `anthropic` or `google.genai` directly. Tests stub by monkeypatching `llm_client.get_llm_client`.

## Architecture

```
calibrate-ai/
├── database.py              # 17-table greenfield schema + connection management
├── db_models.py             # Dataclass + Repository per table (stateless)
├── db_seed.py               # First-run: schema + Default program + admin user
├── prompts.py               # Per-criterion system + user prompt builders
├── llm_client.py            # The only place LLM SDKs are imported
│
├── api/
│   ├── main.py              # FastAPI app, CORS, router registration
│   ├── auth.py              # JWT + bcrypt; get_current_user, require_admin
│   ├── schemas.py           # All Pydantic models (one file)
│   ├── routes/              # auth, programs, projects, rubric, dataset,
│   │                          splits, iterations, scoring_jobs, metrics,
│   │                          disagreements, calibration, locked_prompts,
│   │                          dashboard, users
│   └── services/            # Business logic; routes are thin adapters
│
└── frontend/src/
    ├── styles/tokens.css    # Three-theme design system (light/dark/contrast)
    ├── components/ui/       # Design system primitives (Card, Banner, …)
    ├── layouts/AppShell.tsx # Sidebar + topbar + Outlet
    ├── auth/                # AuthContext, LoginPage
    ├── api/client.ts        # apiFetch + Zod validation wrapper
    ├── schemas/             # Zod schemas mirroring api/schemas.py
    ├── hooks/               # One hook per query/mutation concern
    ├── features/            # Domain composites (setup/, iterate/, posttest/, metrics/)
    └── pages/               # Route-level (one per state-machine phase)
```

## Calibration State Machine

```
setup → baseline_computed → iterating → test_run_complete → locked
                                                          ↘ abandoned → archived
```

- **setup**: define rubric + question schema + applications + human scores; generate splits
- **baseline_computed**: H-H baseline metrics computed (the agreement ceiling)
- **iterating**: versioned per-criterion prompts, score on dev/validation, triage disagreements, generate calibration examples, refine
- **test_run_complete**: single-use test split scored, ready to lock or abandon
- **locked**: snapshotted into `locked_prompts`; project is read-only
- **abandoned/archived**: terminal; clone the project to start over

The `splits` table is reproducible from `projects.random_seed`. The test split is single-use — once a test scoring job completes, splits cannot be regenerated for that project.

## Tables (17 total)

- Identity: `users`, `audit_log`
- Org: `programs`, `projects`
- Rubric (1:1 project): `criteria`
- Dataset (1:1 project): `questions`, `applications`, `human_scores`
- Calibration loop: `splits`, `iterations`, `iteration_prompts`
- Scoring: `scoring_jobs`, `llm_scores`
- Analysis: `agreement_metrics`, `disagreement_flags`, `calibration_examples`
- Output: `locked_prompts`

## Data invariants (non-negotiable)

These rules are enforced across both halves of the codebase. The skills list them in detail; the short version:

1. **No derived data on disk.** Medians, comparisons, totals, aggregate counts are all computed on read.
2. **Score scale is per-criterion.** Every `criteria` row has its own `scale_min`/`scale_max`. Nothing in code assumes 1-3 or 1-5.
3. **One source of truth per concept.** Prompts → `iteration_prompts`. Scoring runs → `scoring_jobs`. Scores → `llm_scores`.
4. **Audit log is generic.** Use `audit_log.entity_type` + `entity_id`, never typed FKs.
5. **Locked prompts snapshot everything** they need into JSON columns. FKs back to projects/iterations are `ON DELETE SET NULL` so artifacts survive deletion.
6. **Cascade discipline.** Project-owned data is `CASCADE`. `projects.program_id` is `RESTRICT`. User FKs are `SET NULL`.
7. **Splits are reproducible** from `projects.random_seed`. Never hand-insert split rows.

The frontend mirrors these: never hardcode score scales, never recompute medians or aggregate counts on the client, treat the project as one rubric + one dataset (clone to reuse).
