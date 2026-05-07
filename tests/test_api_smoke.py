"""End-to-end API smoke: full calibration loop with a stub LLM.

Covers: login → project create → questions → rubric → applications →
human scores → splits → baseline → iteration → dev scoring → metrics →
disagreement flag → calibration examples → v2 iteration → test scoring →
mark test complete → lock → locked-prompt artifact.

This is the regression net for "did we break the calibration loop?"
"""

import time

import pytest


def _wait_for_job(client, headers, job_id, timeout_s: float = 5.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = client.get(f"/api/scoring-jobs/{job_id}", headers=headers).json()
        if s["status"] in ("completed", "failed", "cancelled"):
            return s
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not finish in {timeout_s}s")


def test_full_calibration_loop(client, auth_headers, stub_llm):
    H = auth_headers

    # 1. Create project
    pid = client.post("/api/projects", headers=H, json={
        "program_id": 1, "name": "smoke", "language": "en",
    }).json()["id"]

    # 2. Questions + rubric
    client.put(f"/api/projects/{pid}/questions", headers=H, json={
        "questions": [{"key": "q1", "text": "Tell us", "sort_order": 0}],
    })
    client.put(f"/api/projects/{pid}/rubric", headers=H, json={
        "criteria": [{
            "name": "team", "description": "Strong team",
            "scale_min": 1, "scale_max": 5,
            "anchor_descriptions": {"1": "weak", "2": "thin", "3": "ok", "4": "strong", "5": "top"},
            "feeding_question_keys": ["q1"],
            "weighted_question_keys": ["q1"],
            "sort_order": 0,
        }],
    })

    # 3. Applications + human scores (12 apps, 2 evaluators each)
    apps = [
        {"external_id": f"a{i:02d}", "answers": {"q1": f"Team text EXPECTED_SCORE: {(i % 5) + 1}"}}
        for i in range(12)
    ]
    client.post(f"/api/projects/{pid}/applications", headers=H, json={"applications": apps})

    scores = []
    for i in range(12):
        expected = (i % 5) + 1
        scores.append({"external_id": f"a{i:02d}", "criterion_name": "team",
                       "evaluator_id": "alice", "score": expected})
        scores.append({"external_id": f"a{i:02d}", "criterion_name": "team",
                       "evaluator_id": "bob",
                       "score": max(1, min(5, expected + ((-1) ** i)))})
    client.post(f"/api/projects/{pid}/human-scores", headers=H, json={"scores": scores})

    # 4. Splits
    splits = client.post(f"/api/projects/{pid}/splits", headers=H).json()
    assert sum(splits["counts"].values()) == 12

    # 5. Baseline
    baseline = client.post(f"/api/projects/{pid}/baseline/compute", headers=H).json()
    overall_hh = next(m for m in baseline["overall"] if m["metric"] == "qwk")
    # Synthetic data with ±1 noise from "expected" → high QWK
    assert overall_hh["value"] > 0.5

    # 6. Iteration v1 (auto-gen) + dev scoring
    client.post(f"/api/projects/{pid}/transition", headers=H, json={"new_state": "baseline_computed"})
    client.post(f"/api/projects/{pid}/transition", headers=H, json={"new_state": "iterating"})

    v1 = client.post(f"/api/projects/{pid}/iterations", headers=H, json={"prompts": [], "note": None}).json()
    job = client.post(f"/api/projects/{pid}/iterations/{v1['id']}/score",
                       headers=H, json={"split": "dev"}).json()
    final = _wait_for_job(client, H, job["id"])
    assert final["status"] == "completed"
    # Stub LLM is called once per (app × criterion) on dev split
    expected_calls = splits["counts"]["dev"] * 1   # 1 criterion
    assert stub_llm.score_calls == expected_calls

    # 7. LLM-H metrics
    mm = client.post(f"/api/projects/{pid}/iterations/{v1['id']}/metrics/compute?split=dev",
                     headers=H).json()
    overall_llm = next(m for m in mm["overall"] if m["metric"] == "qwk")
    # Stub matches EXPECTED_SCORE exactly → very high LLM-H QWK
    assert overall_llm["value"] > 0.7

    # 8. Disagreements (humans had ±1 noise vs stub's exact answer)
    disagreements = client.get(
        f"/api/projects/{pid}/iterations/{v1['id']}/disagreements?split=dev",
        headers=H,
    ).json()["disagreements"]
    assert len(disagreements) > 0

    # Flag one
    d = disagreements[0]
    r = client.post(f"/api/projects/{pid}/disagreements/flag", headers=H, json={
        "application_id": d["application_id"],
        "criterion_id": d["criterion_id"],
        "flag": "human_correct",
    })
    assert r.status_code == 204
    counts = client.get(f"/api/projects/{pid}/disagreements/counts", headers=H).json()["counts"]
    assert counts.get("human_correct") == 1

    # 9. Calibration examples
    crit_id = client.get(f"/api/projects/{pid}/rubric", headers=H).json()["criteria"][0]["id"]
    pre_gen_calls = stub_llm.gen_calls
    examples = client.post(
        f"/api/projects/{pid}/criteria/{crit_id}/calibration-examples/generate",
        headers=H, json={"max_examples": 3},
    ).json()["examples"]
    assert len(examples) >= 1
    # One LLM generate() call per synthesized example
    assert stub_llm.gen_calls > pre_gen_calls

    # 10. v2 iteration auto-gen — should embed active examples
    v2 = client.post(f"/api/projects/{pid}/iterations", headers=H,
                     json={"prompts": [], "note": "v2 with examples"}).json()
    assert "Calibration examples" in v2["prompts"][0]["system_prompt"]

    # 11. Score validation + test on v2
    job_v = client.post(f"/api/projects/{pid}/iterations/{v2['id']}/score",
                        headers=H, json={"split": "validation"}).json()
    assert _wait_for_job(client, H, job_v["id"])["status"] == "completed"

    job_t = client.post(f"/api/projects/{pid}/iterations/{v2['id']}/score",
                        headers=H, json={"split": "test"}).json()
    assert _wait_for_job(client, H, job_t["id"])["status"] == "completed"
    client.post(f"/api/projects/{pid}/iterations/{v2['id']}/metrics/compute?split=test",
                headers=H)

    # 12. Lock (after marking test complete)
    # Lock pre-conditions: project must be in test_run_complete; second test
    # scoring would be refused
    refused = client.post(f"/api/projects/{pid}/iterations/{v2['id']}/score",
                          headers=H, json={"split": "test"})
    assert refused.status_code == 409, "test split should be single-use"

    client.post(f"/api/projects/{pid}/transition", headers=H,
                json={"new_state": "test_run_complete"})

    locked = client.post(f"/api/projects/{pid}/lock", headers=H,
                         json={"name": "v1.0"})
    assert locked.status_code == 201, locked.text
    art = locked.json()
    assert art["name"] == "v1.0"
    assert len(art["prompt_hash"]) == 64   # SHA-256 hex
    assert art["prompts_snapshot"]   # non-empty
    assert "llm_h_test" in art["test_metrics"]

    # 13. Project state advanced; can't re-lock
    proj = client.get(f"/api/projects/{pid}", headers=H).json()
    assert proj["state"] == "locked"
    assert proj["has_locked_prompt"]

    second_lock = client.post(f"/api/projects/{pid}/lock", headers=H, json={"name": "v1.1"})
    assert second_lock.status_code == 409

    # 14. Library lists it
    lib = client.get("/api/locked-prompts", headers=H).json()
    assert any(lp["id"] == art["id"] for lp in lib["locked_prompts"])

    # 15. Dashboard reflects the locked count
    dash = client.get("/api/dashboard/stats", headers=H).json()
    assert dash["locked_prompts_count"] == 1


def test_login_rejects_bad_password(client):
    res = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
    assert res.status_code == 401


def test_protected_endpoints_require_auth(client):
    assert client.get("/api/projects").status_code in (401, 403)
    assert client.get("/api/dashboard/stats").status_code in (401, 403)
    assert client.get("/api/programs").status_code in (401, 403)


def test_audit_log_records_lifecycle_events(client, auth_headers):
    H = auth_headers
    pid = client.post("/api/projects", headers=H, json={
        "program_id": 1, "name": "audit-test",
    }).json()["id"]
    client.patch(f"/api/projects/{pid}", headers=H, json={"description": "hello"})

    entries = client.get(
        f"/api/audit?entity_type=project&entity_id={pid}", headers=H,
    ).json()["entries"]
    actions = [e["action"] for e in entries]
    assert "created" in actions
    assert "metadata_updated" in actions
