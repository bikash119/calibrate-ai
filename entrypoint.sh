#!/bin/sh
set -e

echo "==> Seeding database (tables, criteria, prompts)..."
uv run python db_seed.py

# Auto-load applications if a data file is mounted at /data/applications.*
for f in /data/applications.csv /data/applications.xlsx /data/applications.xls; do
    if [ -f "$f" ]; then
        COHORT_YEAR="${COHORT_YEAR:-2025}"
        echo "==> Found $f — loading applications for cohort $COHORT_YEAR..."
        uv run python load_applications.py --input "$f" --cohort-year "$COHORT_YEAR" --verbose
        break
    fi
done

echo "==> Starting server..."
exec uv run uvicorn api.main:app --host 0.0.0.0 --port 8000
