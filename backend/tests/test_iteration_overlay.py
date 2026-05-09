"""Per-criterion ("shape A") iteration overlay + status transitions.

Covers:
- Sparse-overlay creation: only edited criteria get fresh prompts; the rest
  inherit the parent's prompts verbatim.
- Persisted fields: status, parent_iteration_id, edited_criterion_ids round-trip.
- Status transitions (draft → active → abandoned).
- Validation: bad parent, unknown criterion ids, bad status names.

Existing full-mode iteration creation is covered by test_api_smoke; the
overlay path needs its own coverage.
"""

import json as _json


def _seed(client, headers) -> tuple[int, list[int]]:
    """Return (project_id, [criterion_id, criterion_id]) for a 2-criterion project."""
    pid = client.post("/api/projects", headers=headers, json={
        "program_id": 1, "name": "overlay-test", "language": "en",
    }).json()["id"]

    csv = b"id,Tell us about your team,Describe the market\na01,three founders,B2B\n"
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
    return pid, cids


# ------------------------------------------------------------------ #
# Overlay creation                                                   #
# ------------------------------------------------------------------ #


def test_v1_full_creation_unchanged(client, auth_headers, stub_llm):
    """Existing v1 (no parent) auto-generation behavior must be preserved.

    `status='active'`, `parent_iteration_id=null`, `edited_criterion_ids=[]`."""
    pid, _cids = _seed(client, auth_headers)
    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["version"] == 1
    assert body["status"] == "active"
    assert body["parent_iteration_id"] is None
    assert body["edited_criterion_ids"] == []
    # All criteria got prompts.
    assert {p["criterion_name"] for p in body["prompts"]} == {"team", "market"}


def test_overlay_inherits_unedited_prompts_verbatim(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    team_id, market_id = cids

    v1 = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()
    v1_team = next(p["system_prompt"] for p in v1["prompts"] if p["criterion_id"] == team_id)
    v1_market = next(p["system_prompt"] for p in v1["prompts"] if p["criterion_id"] == market_id)

    # v2: only team edited.
    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={
            "prompts": [
                {"criterion_id": team_id, "system_prompt": "EDITED team prompt"},
            ],
            "note": "v2",
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [team_id],
        },
    )
    assert r.status_code == 201, r.text
    v2 = r.json()
    assert v2["version"] == 2
    assert v2["status"] == "active"
    assert v2["parent_iteration_id"] == v1["id"]
    assert v2["edited_criterion_ids"] == [team_id]

    v2_prompts = {p["criterion_id"]: p["system_prompt"] for p in v2["prompts"]}
    # Edited criterion has the new text.
    assert v2_prompts[team_id] == "EDITED team prompt"
    # Inherited criterion carries v1's text verbatim.
    assert v2_prompts[market_id] == v1_market
    # Sanity: v1 team prompt was NOT just propagated.
    assert v2_prompts[team_id] != v1_team


def test_overlay_with_no_prompts_for_edited_criterion_auto_generates(client, auth_headers, stub_llm):
    """Operator can mark a criterion as 'edited' without supplying a prompt —
    that triggers fresh auto-generation (re-injecting calibration examples)."""
    pid, cids = _seed(client, auth_headers)
    team_id = cids[0]

    v1 = client.post(
        f"/api/projects/{pid}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={
            "prompts": [],   # no operator-provided text
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [team_id],
        },
    )
    assert r.status_code == 201, r.text
    v2 = r.json()
    v2_team = next(p["system_prompt"] for p in v2["prompts"] if p["criterion_id"] == team_id)
    # Auto-generated prompt mentions the criterion description.
    assert "Team capability" in v2_team


def test_as_draft_persists_status(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    v1 = client.post(
        f"/api/projects/{pid}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={
            "prompts": [{"criterion_id": cids[0], "system_prompt": "x"}],
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [cids[0]],
            "as_draft": True,
        },
    )
    assert r.status_code == 201
    assert r.json()["status"] == "draft"


def test_overlay_rejects_unknown_parent(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={
            "prompts": [{"criterion_id": cids[0], "system_prompt": "x"}],
            "parent_iteration_id": 999_999,
            "edited_criterion_ids": [cids[0]],
        },
    )
    # Route maps "not found in project" to 404 — semantically correct for
    # "parent_iteration_id references a row that doesn't exist".
    assert r.status_code == 404


def test_overlay_rejects_unknown_edited_criterion(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    v1 = client.post(
        f"/api/projects/{pid}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/iterations",
        headers=auth_headers,
        json={
            "prompts": [],
            "parent_iteration_id": v1["id"],
            "edited_criterion_ids": [999_999],
        },
    )
    assert r.status_code == 400


# ------------------------------------------------------------------ #
# Status transitions                                                 #
# ------------------------------------------------------------------ #


def test_status_can_transition_through_states(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    v1 = client.post(
        f"/api/projects/{pid}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()

    for new_status in ("draft", "active", "abandoned"):
        r = client.post(
            f"/api/projects/{pid}/iterations/{v1['id']}/status",
            headers=auth_headers, json={"status": new_status},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == new_status


def test_status_rejects_invalid_value(client, auth_headers, stub_llm):
    pid, cids = _seed(client, auth_headers)
    v1 = client.post(
        f"/api/projects/{pid}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()

    r = client.post(
        f"/api/projects/{pid}/iterations/{v1['id']}/status",
        headers=auth_headers, json={"status": "garbage"},
    )
    assert r.status_code == 400


def test_status_404_for_cross_project_iteration(client, auth_headers, stub_llm):
    pid_a, cids_a = _seed(client, auth_headers)
    pid_b, _ = _seed(client, auth_headers)
    v1_a = client.post(
        f"/api/projects/{pid_a}/iterations", headers=auth_headers,
        json={"prompts": [], "note": "v1"},
    ).json()
    r = client.post(
        f"/api/projects/{pid_b}/iterations/{v1_a['id']}/status",
        headers=auth_headers, json={"status": "abandoned"},
    )
    assert r.status_code == 404
