"""Project lifecycle: state machine, clone integrity, derived counts."""

import json

import pytest

from db_models import (
    Application,
    ApplicationRepository,
    Criterion,
    CriteriaRepository,
    HumanScore,
    HumanScoreRepository,
    Question,
    QuestionRepository,
)


def _build_minimal_project(seeded_db) -> int:
    """Helper: create a project with rubric, questions, apps, scores."""
    from api.services.project_service import ProjectService

    pid = ProjectService().create(
        program_id=1, name="Test", description=None, language="en", user_id=1,
    )

    QuestionRepository().replace_all(pid, [
        Question(project_id=pid, key="q1", text="Q1", sort_order=0),
    ])

    CriteriaRepository().replace_all(pid, [
        Criterion(
            project_id=pid, name="team", description="Strength of the team",
            scale_min=1, scale_max=5,
            anchor_descriptions_json=json.dumps({
                "1": "weak", "2": "thin", "3": "ok", "4": "strong", "5": "top",
            }),
            feeding_question_keys_json=json.dumps(["q1"]),
            weighted_question_keys_json=json.dumps(["q1"]),
            sort_order=0,
        ),
    ])

    ApplicationRepository().bulk_create([
        Application(project_id=pid, external_id=f"a{i}", answers_json=json.dumps({"q1": f"text {i}"}))
        for i in range(3)
    ])

    crit_id = CriteriaRepository().get_by_project(pid)[0].id
    apps = ApplicationRepository().get_by_project(pid)
    HumanScoreRepository().bulk_create([
        HumanScore(application_id=a.id, criterion_id=crit_id, evaluator_id="alice", score=3)
        for a in apps
    ])

    return pid


# ------------------------------------------------------------------ #
# State machine                                                       #
# ------------------------------------------------------------------ #


def test_state_machine_happy_path(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    pid = svc.create(program_id=1, name="P", description=None, language=None, user_id=1)

    detail = svc.get_detail(pid)
    assert detail["state"] == "setup"

    svc.transition_state(pid, "baseline_computed", user_id=1)
    assert svc.get_detail(pid)["state"] == "baseline_computed"

    svc.transition_state(pid, "iterating", user_id=1)
    svc.transition_state(pid, "test_run_complete", user_id=1)
    svc.transition_state(pid, "abandoned", user_id=1)
    assert svc.get_detail(pid)["state"] == "abandoned"


def test_state_machine_rejects_invalid_transition(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    pid = svc.create(program_id=1, name="P", description=None, language=None, user_id=1)

    # setup → locked is not allowed
    with pytest.raises(ValueError, match="Cannot transition from 'setup'"):
        svc.transition_state(pid, "locked", user_id=1)


def test_state_machine_terminal_archived(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    pid = svc.create(program_id=1, name="P", description=None, language=None, user_id=1)

    svc.transition_state(pid, "abandoned", user_id=1)
    svc.transition_state(pid, "archived", user_id=1)
    # archived has no allowed transitions
    with pytest.raises(ValueError, match="terminal state"):
        svc.transition_state(pid, "locked", user_id=1)


# ------------------------------------------------------------------ #
# Validation on create                                                #
# ------------------------------------------------------------------ #


def test_create_rejects_blank_name(seeded_db):
    from api.services.project_service import ProjectService
    with pytest.raises(ValueError, match="name is required"):
        ProjectService().create(
            program_id=1, name="   ", description=None, language=None, user_id=1,
        )


def test_create_rejects_unknown_program(seeded_db):
    from api.services.project_service import ProjectService
    with pytest.raises(ValueError, match="Program 99999 not found"):
        ProjectService().create(
            program_id=99999, name="P", description=None, language=None, user_id=1,
        )


# ------------------------------------------------------------------ #
# Clone                                                               #
# ------------------------------------------------------------------ #


def test_clone_copies_full_dataset(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    src = _build_minimal_project(seeded_db)
    new_id = svc.clone(src, "clone", user_id=1)

    # Rubric copies
    src_crits = CriteriaRepository().get_by_project(src)
    new_crits = CriteriaRepository().get_by_project(new_id)
    assert len(new_crits) == len(src_crits) == 1
    assert new_crits[0].name == "team"
    # Anchors and JSON references carry over verbatim
    assert new_crits[0].anchor_descriptions_json == src_crits[0].anchor_descriptions_json
    assert new_crits[0].feeding_question_keys_json == src_crits[0].feeding_question_keys_json

    # Questions copy
    new_qs = QuestionRepository().get_by_project(new_id)
    assert len(new_qs) == 1
    assert new_qs[0].key == "q1"

    # Applications copy
    new_apps = ApplicationRepository().get_by_project(new_id)
    assert len(new_apps) == 3
    assert {a.external_id for a in new_apps} == {"a0", "a1", "a2"}

    # Human scores copy with remapped IDs
    new_scores = HumanScoreRepository().get_for_project(new_id)
    assert len(new_scores) == 3
    # All map to the new criterion + new applications (different IDs from source)
    assert all(s.criterion_id == new_crits[0].id for s in new_scores)


def test_clone_starts_fresh(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    src = _build_minimal_project(seeded_db)
    svc.transition_state(src, "baseline_computed", user_id=1)

    new_id = svc.clone(src, "clone", user_id=1)
    detail = svc.get_detail(new_id)
    assert detail["state"] == "setup"
    assert detail["cloned_from_id"] == src
    # New random_seed (overwhelmingly likely to differ; not a guarantee, but
    # the test is fine for sanity)
    assert detail["random_seed"] != svc.get_detail(src)["random_seed"]


def test_clone_rejects_blank_name(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    src = _build_minimal_project(seeded_db)
    with pytest.raises(ValueError, match="Clone name is required"):
        svc.clone(src, "  ", user_id=1)


# ------------------------------------------------------------------ #
# Derived counts                                                      #
# ------------------------------------------------------------------ #


def test_list_with_derived_counts(seeded_db):
    from api.services.project_service import ProjectService
    svc = ProjectService()
    pid = _build_minimal_project(seeded_db)

    rows = svc.list_with_derived()
    target = next(r for r in rows if r["id"] == pid)
    assert target["application_count"] == 3
    assert target["iteration_count"] == 0
    assert target["program_name"] == "Default"
    # No metrics yet
    assert target["latest_dev_qwk"] is None
    assert target["hh_baseline_qwk"] is None
