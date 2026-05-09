"""Selective scoring for per-criterion overlay iterations.

When v(N+1) is created via overlay (sparse prompts + parent_iteration_id),
the worker must:
  - copy llm_scores from the parent's most recent completed job for criteria
    that were NOT edited
  - call the LLM only for the edited criteria
  - have progress_total reflect only the fresh calls

Edge cases:
  - parent has no completed job for the split → score everything fresh
    (no contamination from a stale partial run)
  - v1 (no parent) behaves exactly like before
"""

import json as _json
import time


def _wait_for_job(client, headers, job_id, timeout_s: float = 5.0) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        s = client.get(f"/api/scoring-jobs/{job_id}", headers=headers).json()
        if s["status"] in ("completed", "failed", "cancelled"):
            return s
        time.sleep(0.05)
    raise TimeoutError(f"Job {job_id} did not finish in {timeout_s}s")


N_APPS = 12   # SplitService requires ≥10 for a holdout split.


def _seed_project_with_two_criteria(client, headers) -> tuple[int, list[int]]:
    """A 2-criterion, 12-app project with H-H baseline ready for scoring."""
    pid = client.post("/api/projects", headers=headers, json={
        "program_id": 1, "name": "overlay-scoring", "language": "en",
    }).json()["id"]

    csv_lines = ["id,Team answer,Market answer"]
    for i in range(N_APPS):
        csv_lines.append(f"a{i:02d},team text EXPECTED_SCORE: {(i % 3) + 1},market text EXPECTED_SCORE: {(i % 3) + 1}")
    csv_bytes = ("\n".join(csv_lines) + "\n").encode("utf-8")

    client.post(
        f"/api/projects/{pid}/dataset/import",
        headers=headers,
        files={"file": ("d.csv", csv_bytes, "text/csv")},
        data={"mappings": _json.dumps({
            "sheet_name": None,
            "question_row_index": 0,
            "data_start_row_index": 1,
            "column_mappings": [
                {"column_index": 0, "role": "id"},
                {"column_index": 1, "role": "question"},
                {"column_index": 2, "role": "question"},
            ],
        })},
    )
    rubric = client.put(f"/api/projects/{pid}/rubric", headers=headers, json={
        "criteria": [
            {
                "name": "team", "description": "Team capability",
                "scale_min": 1, "scale_max": 3,
                "anchor_descriptions": {"1": "weak", "2": "ok", "3": "strong"},
                "feeding_question_keys": ["q1"],
                "weighted_question_keys": ["q1"],
                "sort_order": 0,
            },
            {
                "name": "market", "description": "Market clarity",
                "scale_min": 1, "scale_max": 3,
                "anchor_descriptions": {"1": "weak", "2": "ok", "3": "strong"},
                "feeding_question_keys": ["q2"],
                "weighted_question_keys": [],
                "sort_order": 1,
            },
        ],
    }).json()
    cids = [c["id"] for c in rubric["criteria"]]

    # Two evaluators per (app, criterion) so baseline can compute.
    scores = []
    for i in range(N_APPS):
        expected = (i % 3) + 1
        for crit in ("team", "market"):
            for evaluator in ("alice", "bob"):
                scores.append({
                    "external_id": f"a{i:02d}",
                    "criterion_name": crit,
                    "evaluator_id": evaluator,
                    "score": expected,
                })
    client.post(f"/api/projects/{pid}/human-scores", headers=headers, json={"scores": scores})

    client.post(f"/api/projects/{pid}/splits", headers=headers)
    client.post(f"/api/projects/{pid}/baseline/compute", headers=headers)
    client.post(f"/api/projects/{pid}/transition", headers=headers, json={"new_state": "baseline_computed"})
    client.post(f"/api/projects/{pid}/transition", headers=headers, json={"new_state": "iterating"})
    return pid, cids


def test_overlay_scoring_only_calls_llm_for_edited_criteria(client, auth_headers, stub_llm):
    """v2 with only `team` edited → score job runs LLM only for team; market
    inherits its scores from v1's job."""
    H = auth_headers
    pid, cids = _seed_project_with_two_criteria(client, H)
    team_id, market_id = cids

    # ----- v1: full scoring -----
    v1 = client.post(f"/api/projects/{pid}/iterations", headers=H, json={"prompts": [], "note": "v1"}).json()
    job1 = client.post(f"/api/projects/{pid}/iterations/{v1['id']}/score",
                        headers=H, json={"split": "dev"}).json()
    _wait_for_job(client, H, job1["id"])
    v1_calls = stub_llm.score_calls
    # 4 apps × 2 criteria = 8 calls (or fewer if dev split is partial; doesn't matter for the relative check)
    assert v1_calls > 0
    job1_scores = client.get(f"/api/scoring-jobs/{job1['id']}/scores", headers=H).json()["scores"]
    n_dev = len(set(s["application_id"] for s in job1_scores))
    assert len(job1_scores) == n_dev * 2  # both criteria scored

    # ----- v2: overlay, only team edited -----
    v2 = client.post(
        f"/api/projects/{pid}/iterations",
        headers=H,
        json={
            "prompts": [
                {"criterion_id": team_id, "system_prompt": "Edited team prompt"},
            ],
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [team_id],
        },
    ).json()

    job2 = client.post(f"/api/projects/{pid}/iterations/{v2['id']}/score",
                        headers=H, json={"split": "dev"}).json()
    final = _wait_for_job(client, H, job2["id"])
    assert final["status"] == "completed"

    # The LLM was only called n_dev more times (for `team`). Market was inherited.
    new_calls = stub_llm.score_calls - v1_calls
    assert new_calls == n_dev, (
        f"expected {n_dev} fresh team calls; got {new_calls}. "
        "Market should have been inherited from v1, not re-scored."
    )

    # llm_scores for v2's job: n_dev for team (fresh) + n_dev for market (inherited).
    job2_scores = client.get(f"/api/scoring-jobs/{job2['id']}/scores", headers=H).json()["scores"]
    by_crit: dict[int, list[dict]] = {}
    for s in job2_scores:
        by_crit.setdefault(s["criterion_id"], []).append(s)
    assert len(by_crit[team_id]) == n_dev
    assert len(by_crit[market_id]) == n_dev

    # The market scores in v2 should be byte-identical to v1's market scores
    # (we copied them).
    v1_market = sorted(
        ((s["application_id"], s["score"]) for s in job1_scores if s["criterion_id"] == market_id),
    )
    v2_market = sorted(
        ((s["application_id"], s["score"]) for s in job2_scores if s["criterion_id"] == market_id),
    )
    assert v1_market == v2_market

    # progress_total should reflect only fresh calls.
    assert final["progress_total"] == n_dev
    assert final["progress_current"] == n_dev


def test_overlay_with_no_completed_parent_job_falls_back_to_full_scoring(client, auth_headers, stub_llm):
    """If v(N) was never scored on the requested split, v(N+1) can't inherit
    — it must score every criterion fresh, not silently skip them."""
    H = auth_headers
    pid, cids = _seed_project_with_two_criteria(client, H)
    team_id, market_id = cids

    v1 = client.post(f"/api/projects/{pid}/iterations", headers=H, json={"prompts": [], "note": "v1"}).json()
    # NOTE: not scoring v1 — so there's nothing to inherit from.

    v2 = client.post(
        f"/api/projects/{pid}/iterations",
        headers=H,
        json={
            "prompts": [{"criterion_id": team_id, "system_prompt": "x"}],
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [team_id],
        },
    ).json()

    calls_before = stub_llm.score_calls
    job = client.post(f"/api/projects/{pid}/iterations/{v2['id']}/score",
                      headers=H, json={"split": "dev"}).json()
    final = _wait_for_job(client, H, job["id"])
    assert final["status"] == "completed"

    new_calls = stub_llm.score_calls - calls_before
    job_scores = client.get(f"/api/scoring-jobs/{job['id']}/scores", headers=H).json()["scores"]
    n_dev = len(set(s["application_id"] for s in job_scores))
    # Both criteria got scored — we couldn't inherit.
    assert new_calls == n_dev * 2
    assert len(job_scores) == n_dev * 2


def test_v1_unchanged_behavior_preserved(client, auth_headers, stub_llm):
    """The full-scoring path (no parent_iteration_id) is the legacy default
    and must keep scoring every criterion."""
    H = auth_headers
    pid, cids = _seed_project_with_two_criteria(client, H)

    v1 = client.post(f"/api/projects/{pid}/iterations", headers=H, json={"prompts": [], "note": "v1"}).json()
    job = client.post(f"/api/projects/{pid}/iterations/{v1['id']}/score",
                      headers=H, json={"split": "dev"}).json()
    final = _wait_for_job(client, H, job["id"])
    assert final["status"] == "completed"
    job_scores = client.get(f"/api/scoring-jobs/{job['id']}/scores", headers=H).json()["scores"]
    n_dev = len(set(s["application_id"] for s in job_scores))
    # Full coverage: 2 criteria × n_dev apps.
    assert len(job_scores) == n_dev * 2
