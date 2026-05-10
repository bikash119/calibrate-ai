"""Prompt preview endpoint — debug aid that renders the would-be LLM prompts."""

import json as _json


def _setup_project_with_data(client, headers) -> tuple[int, int, int]:
    """Returns (project_id, criterion_id, application_id)."""
    pid = client.post("/api/projects", headers=headers, json={
        "program_id": 1, "name": "preview", "language": "en",
    }).json()["id"]

    csv_bytes = b"id,Tell us about your team\na01,We are 3 founders\na02,Solo founder\n"
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
            ],
        })},
    )

    rubric = client.put(f"/api/projects/{pid}/rubric", headers=headers, json={
        "criteria": [{
            "name": "team", "description": "Strong team capability",
            "scale_min": 1, "scale_max": 3,
            "anchor_descriptions": {
                "1": "Risk to delivery",
                "2": "Some gaps",
                "3": "Has the chops",
            },
            "feeding_question_keys": ["q1"],
            "weighted_question_keys": ["q1"],
            "sort_order": 0,
        }],
    }).json()
    cid = rubric["criteria"][0]["id"]

    apps = client.get(f"/api/projects/{pid}/applications", headers=headers).json()
    aid = apps["applications"][0]["id"]
    return pid, cid, aid


def test_preview_renders_system_and_user_prompt(client, auth_headers):
    pid, cid, aid = _setup_project_with_data(client, auth_headers)

    r = client.get(
        f"/api/projects/{pid}/criteria/{cid}/prompt-preview?application_id={aid}",
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["criterion_id"] == cid
    assert body["criterion_name"] == "team"
    assert body["application_id"] == aid
    assert body["application_external_id"] == "a01"

    # Anchor guidance flows into the system prompt
    assert "Risk to delivery" in body["system_prompt"]
    assert "Has the chops" in body["system_prompt"]
    assert "Strong team capability" in body["system_prompt"]

    # User prompt cites the application's actual answer
    assert "We are 3 founders" in body["user_prompt"]
    assert "a01" in body["user_prompt"]
    # Weighted feeding-key gets the [IMPORTANT] tag
    assert "[IMPORTANT]" in body["user_prompt"]


def test_preview_defaults_to_first_application(client, auth_headers):
    pid, cid, _aid = _setup_project_with_data(client, auth_headers)
    r = client.get(
        f"/api/projects/{pid}/criteria/{cid}/prompt-preview",
        headers=auth_headers,
    )
    assert r.status_code == 200
    assert r.json()["application_external_id"] == "a01"


def test_preview_returns_null_user_prompt_when_no_applications(client, auth_headers):
    """Rubric saved but dataset not yet imported."""
    pid = client.post("/api/projects", headers=auth_headers, json={
        "program_id": 1, "name": "no-apps", "language": "en",
    }).json()["id"]

    # Rubric save needs at least one question key to validate against, so
    # seed a question via the dataset import flow but keep the question alone
    # (no applications). Easiest path: import a single-row CSV (header only,
    # no data) — but our importer requires ≥1 application. So instead, do
    # a 1-row import then delete the application directly via DB.
    csv_bytes = b"id,Tell us\na01,filler\n"
    client.post(
        f"/api/projects/{pid}/dataset/import",
        headers=auth_headers,
        files={"file": ("d.csv", csv_bytes, "text/csv")},
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
    rubric = client.put(f"/api/projects/{pid}/rubric", headers=auth_headers, json={
        "criteria": [{
            "name": "c", "description": "d",
            "scale_min": 1, "scale_max": 3,
            "anchor_descriptions": {"1": "a", "2": "b", "3": "c"},
            "feeding_question_keys": ["q1"],
            "weighted_question_keys": [],
            "sort_order": 0,
        }],
    }).json()
    cid = rubric["criteria"][0]["id"]

    # Drop applications via direct DB access (no public delete-all endpoint)
    from db_models import ApplicationRepository, get_db_cursor
    with get_db_cursor() as cur:
        cur.execute("DELETE FROM applications WHERE project_id = ?", (pid,))
    assert ApplicationRepository().get_by_project(pid) == []

    r = client.get(
        f"/api/projects/{pid}/criteria/{cid}/prompt-preview",
        headers=auth_headers,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["application_id"] is None
    assert body["application_external_id"] is None
    assert body["user_prompt"] is None
    assert body["system_prompt"]   # still rendered


def test_preview_404_for_unknown_criterion(client, auth_headers):
    pid, _cid, _aid = _setup_project_with_data(client, auth_headers)
    r = client.get(
        f"/api/projects/{pid}/criteria/999999/prompt-preview",
        headers=auth_headers,
    )
    assert r.status_code == 404


def test_preview_404_for_criterion_in_other_project(client, auth_headers):
    """Don't let project A peek at project B's criterion."""
    pid_a, cid_a, _ = _setup_project_with_data(client, auth_headers)
    pid_b, _cid_b, _ = _setup_project_with_data(client, auth_headers)
    assert pid_a != pid_b
    r = client.get(
        f"/api/projects/{pid_b}/criteria/{cid_a}/prompt-preview",
        headers=auth_headers,
    )
    assert r.status_code == 404


def test_preview_404_for_application_in_other_project(client, auth_headers):
    pid_a, cid_a, _aid_a = _setup_project_with_data(client, auth_headers)
    _pid_b, _cid_b, aid_b = _setup_project_with_data(client, auth_headers)
    r = client.get(
        f"/api/projects/{pid_a}/criteria/{cid_a}/prompt-preview"
        f"?application_id={aid_b}",
        headers=auth_headers,
    )
    assert r.status_code == 404
