"""Human-score upload — file parse endpoint.

The wide-format wizard needs a 2D-grid preview to let the operator pick
which row holds the headers. This route mirrors `/dataset/parse` but
gates on the human-score lifecycle (setup-only).
"""

import io

import pandas as pd

from db_models import Project, ProjectRepository


# ------------------------------------------------------------------ #
# Helpers                                                            #
# ------------------------------------------------------------------ #


def _csv(rows: list[list[str]]) -> bytes:
    df = pd.DataFrame(rows)
    return df.to_csv(index=False, header=False).encode("utf-8")


def _xlsx(sheets: dict[str, list[list[str]]]) -> bytes:
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        for name, rows in sheets.items():
            pd.DataFrame(rows).to_excel(writer, sheet_name=name, header=False, index=False)
    return buf.getvalue()


def _make_project(state: str = "setup") -> int:
    repo = ProjectRepository()
    return repo.create(Project(
        program_id=1, name="hs-import-test", state=state,
        random_seed=1, created_by=1,
    ))


# ------------------------------------------------------------------ #
# Parse                                                              #
# ------------------------------------------------------------------ #


def test_parse_csv_returns_full_grid(client, auth_headers, seeded_db):
    """Human-score wizard pivots client-side, so the response must include
    every row, not just a preview."""
    pid = _make_project()
    rows = [["external_id", "alice_team", "bob_team"]]
    # 100 data rows — well past the dataset wizard's PREVIEW_ROWS (=25) cutoff
    rows.extend([[f"app-{i}", "3", "2"] for i in range(100)])
    csv = _csv(rows)
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.csv", csv, "text/csv")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["format"] == "csv"
    assert body["preview"]["rows"][0] == ["external_id", "alice_team", "bob_team"]
    assert body["preview"]["rows"][1] == ["app-0", "3", "2"]
    # 1 header row + 100 data rows = 101 total
    assert len(body["preview"]["rows"]) == 101


def test_parse_xlsx_with_multiple_sheets(client, auth_headers, seeded_db):
    """Operator should be able to pick a sheet from a multi-sheet xlsx."""
    pid = _make_project()
    xlsx = _xlsx({
        "Round 1": [
            ["external_id", "alice_team"],
            ["app-1", "3"],
        ],
        "Round 2": [
            ["external_id", "bob_team"],
            ["app-2", "2"],
        ],
    })
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["format"] == "xlsx"
    sheet_names = [s["name"] for s in body["sheets"]]
    assert sheet_names == ["Round 1", "Round 2"]
    assert body["suggested_sheet"] == "Round 1"


def test_parse_xlsx_with_multi_row_headers_returns_full_grid(client, auth_headers, seeded_db):
    """Operator should be able to pick row 1 (real headers) over row 0 (category labels)."""
    pid = _make_project()
    xlsx = _xlsx({
        "Sheet1": [
            ["", "team", "team", "market", "market"],          # category row
            ["external_id", "alice_team", "bob_team", "alice_market", "bob_market"],  # real headers
            ["app-1", "3", "2", "1", "3"],
        ],
    })
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.xlsx", xlsx, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert r.status_code == 200, r.text
    rows = r.json()["preview"]["rows"]
    assert len(rows) == 3
    # Row 0 is the category row — has empty first cell
    assert rows[0][0] in (None, "")
    assert rows[0][1] == "team"
    # Row 1 is the actual header row
    assert rows[1] == ["external_id", "alice_team", "bob_team", "alice_market", "bob_market"]


def test_parse_refuses_outside_setup_state(client, auth_headers, seeded_db):
    pid = _make_project(state="iterating")
    csv = _csv([["external_id", "alice_team"], ["app-1", "3"]])
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.csv", csv, "text/csv")},
    )
    assert r.status_code == 409
    assert "setup" in r.json()["detail"].lower()


def test_parse_404_for_unknown_project(client, auth_headers, seeded_db):
    csv = _csv([["external_id", "alice_team"], ["app-1", "3"]])
    r = client.post(
        "/api/projects/999999/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.csv", csv, "text/csv")},
    )
    assert r.status_code == 404


def test_parse_400_for_unknown_format(client, auth_headers, seeded_db):
    pid = _make_project()
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        headers=auth_headers,
        files={"file": ("scores.txt", b"not a real file", "text/plain")},
    )
    assert r.status_code == 400
    assert "unsupported" in r.json()["detail"].lower()


def test_parse_requires_auth(client, seeded_db):
    pid = _make_project()
    csv = _csv([["external_id", "alice_team"], ["app-1", "3"]])
    r = client.post(
        f"/api/projects/{pid}/human-scores/parse",
        files={"file": ("scores.csv", csv, "text/csv")},
    )
    assert r.status_code == 401
