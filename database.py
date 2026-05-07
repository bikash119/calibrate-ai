"""SQLite connection management and schema for the calibration platform.

Greenfield schema (PRD v2.0): one source of truth per concept.

Tables:
    Identity:            users, audit_log
    Org:                 programs, projects
    Rubric:              criteria
    Dataset:             questions, applications, human_scores
    Calibration loop:    splits, iterations, iteration_prompts
    Scoring:             scoring_jobs, llm_scores
    Analysis:            agreement_metrics, disagreement_flags, calibration_examples
    Output:              locked_prompts
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

DEFAULT_DB_PATH = Path(__file__).parent / "scoring.db"


def get_db_path() -> Path:
    """Resolve the database path from SCORING_DB_PATH env var or the default."""
    env_path = os.environ.get("SCORING_DB_PATH")
    return Path(env_path) if env_path else DEFAULT_DB_PATH


def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a SQLite connection with foreign keys + WAL mode + Row factory."""
    db_path = Path(db_path) if db_path else get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


@contextmanager
def get_db_cursor(db_path: Path | str | None = None) -> Generator[sqlite3.Cursor, None, None]:
    """Cursor context manager — commits on success, rolls back on exception."""
    conn = get_connection(db_path)
    cursor = conn.cursor()
    try:
        yield cursor
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


SCHEMA = """
-- ============================================================
-- Identity
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    entity_type TEXT NOT NULL,
    entity_id INTEGER,
    action TEXT NOT NULL,
    details_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);

-- ============================================================
-- Org: Program -> Project
-- ============================================================

CREATE TABLE IF NOT EXISTS programs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    program_id INTEGER NOT NULL REFERENCES programs(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT,
    language TEXT,
    state TEXT NOT NULL DEFAULT 'setup' CHECK(state IN (
        'setup', 'baseline_computed', 'iterating',
        'test_run_complete', 'locked', 'abandoned', 'archived'
    )),
    random_seed INTEGER NOT NULL,
    cloned_from_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_projects_program ON projects(program_id);
CREATE INDEX IF NOT EXISTS idx_projects_state ON projects(state);

-- ============================================================
-- Rubric (1:1 with project)
-- ============================================================

CREATE TABLE IF NOT EXISTS criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    scale_min INTEGER NOT NULL,
    scale_max INTEGER NOT NULL,
    anchor_descriptions_json TEXT NOT NULL,
    feeding_question_keys_json TEXT NOT NULL DEFAULT '[]',
    weighted_question_keys_json TEXT NOT NULL DEFAULT '[]',
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, name),
    CHECK(scale_max > scale_min)
);
CREATE INDEX IF NOT EXISTS idx_criteria_project ON criteria(project_id);

-- ============================================================
-- Dataset (1:1 with project)
-- ============================================================

CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(project_id, key)
);
CREATE INDEX IF NOT EXISTS idx_questions_project ON questions(project_id);

CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    external_id TEXT NOT NULL,
    answers_json TEXT NOT NULL,
    metadata_json TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_applications_project ON applications(project_id);

CREATE TABLE IF NOT EXISTS human_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    evaluator_id TEXT NOT NULL,
    score INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(application_id, criterion_id, evaluator_id)
);
CREATE INDEX IF NOT EXISTS idx_human_scores_app_crit ON human_scores(application_id, criterion_id);

-- ============================================================
-- Splits (60/20/20 holdout — derived from random_seed)
-- ============================================================

CREATE TABLE IF NOT EXISTS splits (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    split TEXT NOT NULL CHECK(split IN ('dev', 'validation', 'test')),
    PRIMARY KEY(project_id, application_id)
);
CREATE INDEX IF NOT EXISTS idx_splits_project_split ON splits(project_id, split);

-- ============================================================
-- Iteration loop (prompt versions per project)
-- ============================================================

CREATE TABLE IF NOT EXISTS iterations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    note TEXT,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, version)
);
CREATE INDEX IF NOT EXISTS idx_iterations_project ON iterations(project_id);

CREATE TABLE IF NOT EXISTS iteration_prompts (
    iteration_id INTEGER NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    system_prompt TEXT NOT NULL,
    PRIMARY KEY(iteration_id, criterion_id)
);

-- ============================================================
-- Scoring (LLM jobs and scores)
-- ============================================================

CREATE TABLE IF NOT EXISTS scoring_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    iteration_id INTEGER NOT NULL REFERENCES iterations(id) ON DELETE CASCADE,
    split TEXT NOT NULL CHECK(split IN ('dev', 'validation', 'test', 'production')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    progress_total INTEGER NOT NULL DEFAULT 0,
    progress_current INTEGER NOT NULL DEFAULT 0,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    batch_external_id TEXT,
    cost_estimate_usd REAL,
    cost_actual_usd REAL,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_scoring_jobs_status ON scoring_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_scoring_jobs_iteration ON scoring_jobs(iteration_id);

CREATE TABLE IF NOT EXISTS llm_scores (
    job_id INTEGER NOT NULL REFERENCES scoring_jobs(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    score INTEGER NOT NULL,
    reasoning TEXT,
    raw_response TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(job_id, application_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_llm_scores_app_crit ON llm_scores(application_id, criterion_id);

-- ============================================================
-- Analysis (agreement metrics, operator flags, few-shot examples)
-- ============================================================

CREATE TABLE IF NOT EXISTS agreement_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    iteration_id INTEGER REFERENCES iterations(id) ON DELETE CASCADE,
    split TEXT NOT NULL CHECK(split IN ('dev', 'validation', 'test', 'all')),
    criterion_id INTEGER REFERENCES criteria(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    value REAL,
    ci_low REAL,
    ci_high REAL,
    n INTEGER,
    computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, iteration_id, split, criterion_id, metric)
);
CREATE INDEX IF NOT EXISTS idx_metrics_project ON agreement_metrics(project_id);
CREATE INDEX IF NOT EXISTS idx_metrics_iteration ON agreement_metrics(iteration_id);

CREATE TABLE IF NOT EXISTS disagreement_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    flag TEXT NOT NULL CHECK(flag IN ('llm_correct', 'human_correct', 'ambiguous')),
    flagged_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, application_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_flags_project ON disagreement_flags(project_id);

CREATE TABLE IF NOT EXISTS calibration_examples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    criterion_id INTEGER NOT NULL REFERENCES criteria(id) ON DELETE CASCADE,
    application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    human_score INTEGER NOT NULL,
    synthesized_reasoning TEXT NOT NULL,
    condensed_answers_json TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('operator_flagged', 'evaluator_consensus', 'auto', 'manual')),
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, criterion_id, application_id)
);
CREATE INDEX IF NOT EXISTS idx_cal_examples_active ON calibration_examples(project_id, criterion_id, is_active);

-- ============================================================
-- Output: the immutable locked prompt artifact
-- ============================================================

CREATE TABLE IF NOT EXISTS locked_prompts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
    iteration_id INTEGER REFERENCES iterations(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    rubric_snapshot_json TEXT NOT NULL,
    prompts_snapshot_json TEXT NOT NULL,
    examples_snapshot_json TEXT,
    prompt_hash TEXT NOT NULL,
    test_metrics_json TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    locked_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_locked_project ON locked_prompts(project_id);
"""


# Order matters for drop_all_tables (children before parents).
_TABLES_DROP_ORDER = [
    "locked_prompts",
    "calibration_examples",
    "disagreement_flags",
    "agreement_metrics",
    "llm_scores",
    "scoring_jobs",
    "iteration_prompts",
    "iterations",
    "splits",
    "human_scores",
    "applications",
    "questions",
    "criteria",
    "projects",
    "programs",
    "audit_log",
    "users",
]


def init_db(db_path: Path | str | None = None) -> Path:
    """Create the database (idempotent — uses CREATE IF NOT EXISTS)."""
    db_path = Path(db_path) if db_path else get_db_path()
    with get_db_cursor(db_path) as cursor:
        cursor.executescript(SCHEMA)
    return db_path


def drop_all_tables(db_path: Path | str | None = None) -> None:
    """Drop every table. Used by reset_db; not for production."""
    with get_db_cursor(db_path) as cursor:
        for table in _TABLES_DROP_ORDER:
            cursor.execute(f"DROP TABLE IF EXISTS {table}")


def reset_db(db_path: Path | str | None = None) -> Path:
    """Drop and recreate. Destructive — only for local dev/tests."""
    drop_all_tables(db_path)
    return init_db(db_path)
