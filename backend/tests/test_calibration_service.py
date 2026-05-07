"""Calibration example generation: selection priority, diversity, source labels."""

import json

import pytest

from db_models import (
    Application,
    ApplicationRepository,
    Criterion,
    CriteriaRepository,
    DisagreementFlag,
    DisagreementFlagRepository,
    HumanScore,
    HumanScoreRepository,
    Question,
    QuestionRepository,
    Split,
    SplitRepository,
)


def _build(seeded_db, scoring_pattern: list[tuple[str, list[int]]]):
    """Set up a project with N applications, each scored by all evaluators in
    the given pattern: [(external_id, [evaluator_scores...]), ...]. Returns
    (project_id, criterion_id, app_id_by_external)."""
    from api.services.project_service import ProjectService

    pid = ProjectService().create(
        program_id=1, name="cal-test", description=None, language=None, user_id=1,
    )
    QuestionRepository().replace_all(pid, [
        Question(project_id=pid, key="q1", text="Q1", sort_order=0),
    ])
    CriteriaRepository().replace_all(pid, [
        Criterion(
            project_id=pid, name="team", description="strength of the team",
            scale_min=1, scale_max=5,
            anchor_descriptions_json=json.dumps({
                "1": "weak", "2": "thin", "3": "ok", "4": "strong", "5": "top",
            }),
            feeding_question_keys_json=json.dumps(["q1"]),
            weighted_question_keys_json=json.dumps(["q1"]),
            sort_order=0,
        ),
    ])
    crit_id = CriteriaRepository().get_by_project(pid)[0].id

    apps_to_create = [
        Application(project_id=pid, external_id=ext,
                    answers_json=json.dumps({"q1": f"team text for {ext}"}))
        for ext, _ in scoring_pattern
    ]
    ApplicationRepository().bulk_create(apps_to_create)
    apps = ApplicationRepository().get_by_project(pid)
    by_external = {a.external_id: a.id for a in apps}

    # Put every app in dev split so the calibration service considers them
    SplitRepository().replace_all(pid, [
        Split(project_id=pid, application_id=a.id, split="dev") for a in apps
    ])

    score_rows = []
    for ext, evaluator_scores in scoring_pattern:
        for i, score in enumerate(evaluator_scores):
            score_rows.append(HumanScore(
                application_id=by_external[ext], criterion_id=crit_id,
                evaluator_id=f"e{i}", score=score,
            ))
    HumanScoreRepository().bulk_create(score_rows)

    return pid, crit_id, by_external


def test_consensus_apps_become_examples(seeded_db, stub_llm):
    """When evaluators all agree, those apps should be selected first."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, _ = _build(seeded_db, [
        ("a1", [1, 1]),    # consensus, score 1
        ("a3", [3, 3]),    # consensus, score 3
        ("a5", [5, 5]),    # consensus, score 5
    ])
    examples = CalibrationService().generate(pid, crit_id, max_examples=3, user_id=1)
    assert len(examples) == 3
    assert all(e["source"] == "evaluator_consensus" for e in examples)
    # Diverse score levels
    assert {e["human_score"] for e in examples} == {1, 3, 5}


def test_operator_flagged_takes_priority(seeded_db, stub_llm):
    """An operator-flagged 'human_correct' app should win over consensus."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, by_external = _build(seeded_db, [
        ("flagged", [4, 5]),      # disagreeing, will be flagged
        ("consensus", [3, 3]),    # consensus
    ])
    DisagreementFlagRepository().upsert(DisagreementFlag(
        project_id=pid,
        application_id=by_external["flagged"],
        criterion_id=crit_id,
        flag="human_correct",
        flagged_by=1,
    ))

    examples = CalibrationService().generate(pid, crit_id, max_examples=2, user_id=1)
    by_app = {e["application_external_id"]: e for e in examples}
    assert by_app["flagged"]["source"] == "operator_flagged"
    assert by_app["consensus"]["source"] == "evaluator_consensus"


def test_diverse_score_levels_preferred(seeded_db, stub_llm):
    """When multiple consensus apps exist for the same score, only one is
    chosen — preferring spread across score levels."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, _ = _build(seeded_db, [
        ("a", [3, 3]),
        ("b", [3, 3]),
        ("c", [3, 3]),
        ("d", [5, 5]),
    ])
    examples = CalibrationService().generate(pid, crit_id, max_examples=2, user_id=1)
    # Two examples chosen → distinct score levels
    scores = {e["human_score"] for e in examples}
    assert len(scores) == 2


def test_median_fallback_when_no_consensus(seeded_db, stub_llm):
    """If all apps have evaluator disagreement, fall back to median."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, _ = _build(seeded_db, [
        ("a", [1, 3]),    # median 2
        ("b", [2, 4]),    # median 3
    ])
    examples = CalibrationService().generate(pid, crit_id, max_examples=2, user_id=1)
    assert len(examples) == 2
    assert all(e["source"] == "auto" for e in examples)


def test_refuses_when_no_data(seeded_db, stub_llm):
    """No human-scored apps in dev → graceful error, not crash."""
    from api.services.calibration_service import CalibrationService
    from api.services.project_service import ProjectService

    pid = ProjectService().create(
        program_id=1, name="empty", description=None, language=None, user_id=1,
    )
    QuestionRepository().replace_all(pid, [
        Question(project_id=pid, key="q1", text="Q1", sort_order=0),
    ])
    CriteriaRepository().replace_all(pid, [
        Criterion(
            project_id=pid, name="team", description="x",
            scale_min=1, scale_max=3,
            anchor_descriptions_json=json.dumps({"1": "low", "2": "mid", "3": "hi"}),
            feeding_question_keys_json=json.dumps(["q1"]),
            weighted_question_keys_json="[]",
            sort_order=0,
        ),
    ])
    crit_id = CriteriaRepository().get_by_project(pid)[0].id
    with pytest.raises(ValueError, match="Dev split is empty"):
        CalibrationService().generate(pid, crit_id, max_examples=3, user_id=1)


def test_synthesizes_reasoning_via_llm(seeded_db, stub_llm):
    from api.services.calibration_service import CalibrationService
    pid, crit_id, _ = _build(seeded_db, [
        ("a1", [1, 1]),
        ("a3", [3, 3]),
    ])
    examples = CalibrationService().generate(pid, crit_id, max_examples=2, user_id=1)
    assert stub_llm.gen_calls == 2
    for ex in examples:
        assert ex["synthesized_reasoning"]
        assert "Synthesized" in ex["synthesized_reasoning"]
