# Calibrate AI

**Calibrate LLMs to score like your human evaluators do.** Self-hosted, open source.

Most "LLM scoring" tools just have an LLM evaluate something against a rubric and call it done. The result usually doesn't match how your actual evaluators score — and you have no way to measure the gap, let alone close it. Calibrate AI is built around that gap.

## How it works

1. **Upload** your rubric, your applications (CSV or JSON), and your evaluators' scores.
2. **Compute the human-human baseline** — how well your own evaluators agree with each other. This is the ceiling: an LLM cannot reliably exceed it.
3. **Iterate prompts** — auto-generate per-criterion prompts from the rubric, score the dev split, see exactly where the LLM disagrees with humans on every (application, criterion) pair, and flag who was right.
4. **Generate calibration examples** from your flagged disagreements — these become few-shot examples in the next prompt version.
5. **Re-score, compare metrics** (QWK with bootstrap confidence intervals, exact agreement, within-1, Krippendorff's α) — traffic-lit against the H-H ceiling so you can see when you've matched human-level agreement.
6. **Run the held-out test split once** when you're confident, **lock the artifact** if metrics hold up. The locked prompt is immutable: rubric + per-criterion system prompts + calibration examples + test metrics, all snapshotted with a SHA-256 hash for integrity.

The platform refuses to let you peek at the test split during iteration, refuses to regenerate splits after the test set is consumed, and refuses to lock without a completed test run. The math is honest by construction.

## Features

- **Multi-LLM** — Claude (Anthropic) or Gemini (Google), pluggable via one factory
- **Versioned prompts** — every iteration is immutable; per-criterion unified diff between versions
- **Generic scales** — every criterion has its own `scale_min`/`scale_max`. Mix 1-3 and 1-5 in the same rubric if you need to.
- **Server-side medians, server-side metrics** — the platform owns the math; the UI just renders
- **Test-set protection** — single-use, enforced in the data layer
- **Calibration examples** — operator-flagged disagreements bubble to the top of the candidate pool, with diversity across score levels
- **Locked-prompt library** — every locked artifact is self-contained and survives project deletion
- **Audit log** — every state change, upload, and lock is timestamped and attributed
- **Self-hosted** — single SQLite file, no external services required (besides the LLM you choose)

## Quick start

### Prerequisites

- Python 3.12+ ([uv](https://docs.astral.sh/uv/) for package management)
- Node.js 20+ (for the frontend)
- API key for Claude or Gemini

### Run it

```bash
git clone https://github.com/your-org/calibrate-ai.git
cd calibrate-ai

# Backend
uv sync
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY (or GOOGLE_API_KEY + LLM_PROVIDER=gemini)
uv run python db_seed.py     # creates schema + Default program + admin user
uvicorn api.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev                  # http://localhost:5173
```

Default login: `admin / admin`. Override via `CALIBRATE_ADMIN_USERNAME` and `CALIBRATE_ADMIN_PASSWORD` env vars before running `db_seed.py`.

### Or use Docker

```bash
cp .env.example .env
docker compose up --build
# http://localhost:8000
```

### Run the tests

```bash
uv run pytest
```

The test suite covers the agreement-statistics primitives (QWK, Krippendorff's α, bootstrap CI), the project state machine, calibration-example selection priority, and a full end-to-end smoke through the API.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `LLM_PROVIDER` | no | `claude` (default) or `gemini` |
| `ANTHROPIC_API_KEY` | when claude | Anthropic API key |
| `GOOGLE_API_KEY` | when gemini | Skip if running on Vertex AI with a VM service account |
| `GCP_PROJECT`, `GCP_LOCATION` | no | Vertex AI batch — not used by the sequential scoring loop |
| `SCORING_DB_PATH` | no | SQLite file path (default `./scoring.db`) |
| `JWT_SECRET` | **yes in production** | JWT signing secret. Override the default. |
| `CALIBRATE_ADMIN_USERNAME` | no | Admin user seeded by `db_seed.py` (default `admin`) |
| `CALIBRATE_ADMIN_PASSWORD` | no | **Override this** before going to production. |

## Architecture (one paragraph)

A FastAPI + SQLite backend with a 17-table schema organized around a `projects` entity that owns one rubric (`criteria`), one dataset (`questions` + `applications` + `human_scores`), versioned `iterations`, scoring `jobs`, and immutable `locked_prompts`. Agreement metrics are stored generically in `agreement_metrics` — H-H baseline (iteration_id NULL) and LLM-H per iteration share the same table. A React + Vite + Tailwind frontend mirrors this with Zod-validated hooks and a design-token system that supports light, dark, and high-contrast themes. The full architecture and invariants are documented in `CLAUDE.md` and the `/backend` and `/frontend` development skills under `.claude/skills/`.

## License

Apache 2.0. See [LICENSE](LICENSE).

## Status

Pre-1.0. The calibration loop is feature-complete and end-to-end tested. Things deferred for future versions: batch scoring via Vertex AI / Anthropic Message Batches (only sequential is implemented), provider parity comparison reports, and frontend test coverage. See `CLAUDE.md` for current architecture conventions.
