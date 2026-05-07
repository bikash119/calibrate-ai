"""Shared pytest fixtures.

Each test gets a fresh SQLite database, a seeded admin user, and an authenticated
TestClient. LLM calls are stubbed by default — opt back in with the live_llm
fixture only if you need real API calls.
"""

import os
import tempfile
from pathlib import Path
from typing import Any, Iterator

import pytest


# ------------------------------------------------------------------ #
# Database fixtures                                                   #
# ------------------------------------------------------------------ #


@pytest.fixture
def db_path(monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Fresh SQLite file per test, with SCORING_DB_PATH pointed at it."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        path = Path(f.name)
    # Remove the empty file so init_db creates it cleanly with WAL setup
    path.unlink(missing_ok=True)
    monkeypatch.setenv("SCORING_DB_PATH", str(path))
    monkeypatch.setenv("CALIBRATE_ADMIN_PASSWORD", "test-pw")
    monkeypatch.setenv("JWT_SECRET", "test-secret-long-enough-to-satisfy-pyjwt-32b")
    yield path
    path.unlink(missing_ok=True)
    # Also clear -wal/-shm sidecars from WAL mode
    for suffix in (".db-wal", ".db-shm"):
        sidecar = path.with_name(path.name + suffix.replace(".db", ""))
        sidecar.unlink(missing_ok=True)


@pytest.fixture
def seeded_db(db_path: Path) -> Path:
    """Initialized DB + Default program + admin user."""
    from db_seed import seed_admin_user, seed_default_program
    from database import init_db

    init_db(db_path)
    admin_id = seed_admin_user()
    seed_default_program(created_by=admin_id)
    return db_path


# ------------------------------------------------------------------ #
# LLM stub                                                            #
# ------------------------------------------------------------------ #


class StubLLM:
    """Deterministic test LLM: pulls scores from EXPECTED_SCORE: N markers in
    the user prompt; falls back to mid-scale otherwise."""

    def __init__(self) -> None:
        self.score_calls = 0
        self.gen_calls = 0

    def score(self, system: str, user: str) -> dict[str, Any]:
        self.score_calls += 1
        import re
        m = re.search(r"EXPECTED_SCORE:\s*(\d+)", user)
        return {
            "score": int(m.group(1)) if m else 3,
            "reasoning": "stub reasoning",
        }

    def generate(self, system: str, user: str) -> str:
        self.gen_calls += 1
        return "Synthesized: the answer cites specific evidence aligned with the rubric anchor."


@pytest.fixture
def stub_llm(monkeypatch: pytest.MonkeyPatch, seeded_db: Path) -> StubLLM:
    """Patch get_llm_client both at the source module AND wherever consumer
    modules already imported the symbol. `from llm_client import get_llm_client`
    captures the function at import time, so patching the source alone leaves
    stale references in services that loaded before us."""
    import importlib

    import llm_client

    stub = StubLLM()
    monkeypatch.setattr(llm_client, "get_llm_client", lambda: stub)

    for module_name in (
        "api.services.scoring_job_service",
        "api.services.calibration_service",
    ):
        try:
            mod = importlib.import_module(module_name)
            monkeypatch.setattr(mod, "get_llm_client", lambda: stub, raising=False)
        except ImportError:
            pass

    return stub


# ------------------------------------------------------------------ #
# TestClient + auth                                                   #
# ------------------------------------------------------------------ #


@pytest.fixture
def client(seeded_db: Path) -> Any:
    """TestClient with a fresh app instance. Importing api.main inside the
    fixture ensures init_db runs against the test database."""
    # api.main imports modules at module-level; we want a fresh import per test
    # to avoid sharing state across runs.
    import sys
    for mod in list(sys.modules):
        if mod.startswith("api."):
            del sys.modules[mod]

    from fastapi.testclient import TestClient
    from api.main import app
    return TestClient(app)


@pytest.fixture
def auth_headers(client: Any) -> dict[str, str]:
    """Authorization headers for the seeded admin user."""
    res = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "test-pw"},
    )
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['access_token']}"}
