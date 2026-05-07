#!/bin/sh
set -e

echo "==> Seeding database (idempotent)…"
uv run python db_seed.py

echo "==> Starting server on :8000"
exec uv run uvicorn api.main:app --host 0.0.0.0 --port 8000
