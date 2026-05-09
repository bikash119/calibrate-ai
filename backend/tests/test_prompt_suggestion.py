"""Auto-suggest refined system prompt — unit + endpoint coverage.

The route is `POST /api/projects/{pid}/iterations/{iid}/criteria/{cid}/suggest-prompt`.
Backed by `suggest_refined_prompt` in the prompt_suggestion_service.
"""

import json as _json
import time

import pytest


def _wait_for_job(client, headers, job_id, timeout_s: float = 5.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = client.get(f"/api/scoring-jobs/{job_id}", headers=headers).json()
        if s["status"] in ("completed", "failed", "cancelled"):
            return s
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not finish")


def _seed_with_scored_v1(client, headers) -> tuple[int, int, int, int]:
    """Project + 12 apps + scored v1 with disagreements ready to suggest from."""
    pid = client.post("/api/projects", headers=headers, json={
        "program_id": 1, "name": "suggest-test", "language": "en",
    }).json()["id"]

    csv_lines = ["id,Q1"]
    for i in range(12):
        csv_lines.append(f"a{i:02d},text EXPECTED_SCORE: {(i % 3) + 1}")
    csv = ("\n".join(csv_lines) + "\n").encode("utf-8")

    client.post(
        f"/api/projects/{pid}/dataset/import",
        headers=headers,
        files={"file": ("d.csv", csv, "text/csv")},
        data={"mappings": _json.dumps({
            "sheet_name": None,
            "question_row_index": 0,
            "data_start_row_index": 1,
            "column_mappings": [
                {"column_index": 0, "role": "id"},
                {"column_index": 1, "role": "question"},
            ],
        })},
    )
    rubric = client.put(f"/api/projects/{pid}/rubric", headers=headers, json={
        "criteria": [{
            "name": "team", "description": "Team capability",
            "scale_min": 1, "scale_max": 3,
            "anchor_descriptions": {"1": "weak", "2": "ok", "3": "strong"},
            "feeding_question_keys": ["q1"],
            "weighted_question_keys": ["q1"],
            "sort_order": 0,
        }],
    }).json()
    cid = rubric["criteria"][0]["id"]

    # Two evaluators per app, with deliberate disagreements vs LLM later.
    scores = []
    for i in range(12):
        # Humans score 1 for all even apps and 3 for odd — our stub LLM
        # will return 2 (mid-scale), so every row will be a disagreement.
        h = 1 if i % 2 == 0 else 3
        for ev in ("alice", "bob"):
            scores.append({
                "external_id": f"a{i:02d}",
                "criterion_name": "team",
                "evaluator_id": ev,
                "score": h,
            })
    client.post(f"/api/projects/{pid}/human-scores", headers=headers, json={"scores": scores})

    client.post(f"/api/projects/{pid}/splits", headers=headers)
    client.post(f"/api/projects/{pid}/baseline/compute", headers=headers)
    client.post(f"/api/projects/{pid}/transition", headers=headers, json={"new_state": "baseline_computed"})
    client.post(f"/api/projects/{pid}/transition", headers=headers, json={"new_state": "iterating"})

    v1 = client.post(f"/api/projects/{pid}/iterations", headers=headers,
                     json={"prompts": [], "note": "v1"}).json()
    job = client.post(f"/api/projects/{pid}/iterations/{v1['id']}/score",
                      headers=headers, json={"split": "dev"}).json()
    _wait_for_job(client, headers, job["id"])
    return pid, cid, v1["id"], job["id"]


# ------------------------------------------------------------------ #


@pytest.fixture
def stub_suggester(monkeypatch):
    """Replace the LLM client with a deterministic suggester. Returns the
    list of (system, user) tuples it received so tests can assert on them."""
    received: list[tuple[str, str]] = []

    class _Suggester:
        def score(self, s, u):
            return {"score": 2, "reasoning": "stub"}

        def generate(self, s, u):
            received.append((s, u))
            # Echo-back the marker so we can verify lessons made it into the
            # user prompt.
            return _json.dumps({
                "suggested_prompt": "REFINED PROMPT (from stub)",
                "reasoning": "Tightened the score-1 anchor based on disagreements.",
            })

    instance = _Suggester()

    import llm_client
    monkeypatch.setattr(llm_client, "get_llm_client", lambda *a, **kw: instance)
    import api.services.prompt_suggestion_service as mod
    monkeypatch.setattr(mod, "get_llm_client", lambda *a, **kw: instance)
    import api.services.scoring_job_service as sjs
    monkeypatch.setattr(sjs, "get_llm_client", lambda *a, **kw: instance)
    return received


# ------------------------------------------------------------------ #


def test_suggest_prompt_uses_disagreements_as_signal(client, auth_headers, stub_suggester):
    pid, cid, v1, _job_id = _seed_with_scored_v1(client, auth_headers)
    r = client.post(
        f"/api/projects/{pid}/iterations/{v1}/criteria/{cid}/suggest-prompt",
        headers=auth_headers,
        json={"current_prompt": "Old prompt body", "lesson_cap": 3},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["suggested_prompt"] == "REFINED PROMPT (from stub)"
    assert "tightened" in body["reasoning"].lower()

    # User prompt must include the current prompt and at least one
    # disagreement record from the scored job.
    assert len(stub_suggester) > 0
    _system, user = stub_suggester[-1]
    assert "Old prompt body" in user
    assert "LLM said:" in user
    assert "Human median:" in user


def test_suggest_prompt_falls_back_to_stored_prompt_when_blank(client, auth_headers, stub_suggester):
    """When the operator hasn't typed anything yet, the service uses the
    iteration's stored prompt for that criterion as the starting point."""
    pid, cid, v1, _ = _seed_with_scored_v1(client, auth_headers)
    r = client.post(
        f"/api/projects/{pid}/iterations/{v1}/criteria/{cid}/suggest-prompt",
        headers=auth_headers,
        json={},
    )
    assert r.status_code == 200, r.text
    _system, user = stub_suggester[-1]
    # The auto-generated v1 prompt mentions the criterion's name + description.
    assert "team" in user.lower()


def test_suggest_prompt_404_for_unknown_criterion(client, auth_headers, stub_suggester):
    pid, _cid, v1, _ = _seed_with_scored_v1(client, auth_headers)
    r = client.post(
        f"/api/projects/{pid}/iterations/{v1}/criteria/999999/suggest-prompt",
        headers=auth_headers, json={},
    )
    assert r.status_code == 404


def test_suggest_prompt_400_when_no_signal_available(client, auth_headers, stub_suggester):
    """If the parent iteration was never scored, there's nothing to teach
    the suggester from."""
    pid = client.post("/api/projects", headers=auth_headers, json={
        "program_id": 1, "name": "no-signal", "language": "en",
    }).json()["id"]
    csv = b"id,Q\n" + b"\n".join(f"a{i:02d},x".encode() for i in range(12)) + b"\n"
    client.post(f"/api/projects/{pid}/dataset/import", headers=auth_headers,
                files={"file": ("d.csv", csv, "text/csv")},
                data={"mappings": _json.dumps({
                    "sheet_name": None, "question_row_index": 0,
                    "data_start_row_index": 1,
                    "column_mappings": [
                        {"column_index": 0, "role": "id"},
                        {"column_index": 1, "role": "question"},
                    ],
                })})
    rubric = client.put(f"/api/projects/{pid}/rubric", headers=auth_headers, json={
        "criteria": [{
            "name": "team", "description": "T", "scale_min": 1, "scale_max": 3,
            "anchor_descriptions": {"1": "a", "2": "b", "3": "c"},
            "feeding_question_keys": ["q1"], "weighted_question_keys": [],
            "sort_order": 0,
        }],
    }).json()
    cid = rubric["criteria"][0]["id"]
    v1 = client.post(f"/api/projects/{pid}/iterations", headers=auth_headers,
                     json={"prompts": [], "note": "v1"}).json()
    # NOTE: v1 was never scored, so there are no llm_scores to compare.

    r = client.post(
        f"/api/projects/{pid}/iterations/{v1['id']}/criteria/{cid}/suggest-prompt",
        headers=auth_headers, json={"current_prompt": "x"},
    )
    assert r.status_code == 400
    assert "disagreement" in r.json()["detail"].lower()
