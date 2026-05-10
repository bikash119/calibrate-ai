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


# ============================================================
# promote_single — one-row promotion from disagreements/agreements
# ============================================================


def test_promote_single_disagreement_creates_example(seeded_db, stub_llm):
    """Operator picks one application from the SelectExamplesModal's
    Disagreements tab → row appears in calibration_examples with
    is_active=1 and LLM-generated reasoning."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, by_ext = _build(seeded_db, [
        ("a1", [1, 1]),
        ("a2", [3, 3]),
    ])
    service = CalibrationService()
    before = service.list_for_criterion(pid, crit_id)
    assert before == []   # nothing seeded

    new = service.promote_single(
        pid, crit_id, by_ext["a1"], human_score=1,
        source="operator_flagged", user_id=1,
    )
    assert new["application_id"] == by_ext["a1"]
    assert new["human_score"] == 1
    assert new["source"] == "operator_flagged"
    assert new["is_active"] is True
    assert new["synthesized_reasoning"]   # LLM stub returns non-empty text

    # Doesn't replace existing rows — append, not destroy.
    second = service.promote_single(
        pid, crit_id, by_ext["a2"], human_score=3,
        source="manual", user_id=1,
    )
    rows = service.list_for_criterion(pid, crit_id)
    assert len(rows) == 2
    sort_orders = sorted(r["sort_order"] for r in rows)
    assert sort_orders == [0, 1]   # appended, not overlapping
    assert second["sort_order"] == 1


def test_promote_single_agreement_uses_manual_source(seeded_db, stub_llm):
    """Agreements (LLM=human) get promoted with source='manual' — distinct
    from operator_flagged so we can tell promoted-positives from
    promoted-corrections later."""
    from api.services.calibration_service import CalibrationService
    pid, crit_id, by_ext = _build(seeded_db, [("a1", [3, 3])])
    new = CalibrationService().promote_single(
        pid, crit_id, by_ext["a1"], human_score=3,
        source="manual", user_id=1,
    )
    assert new["source"] == "manual"
    assert new["human_score"] == 3


def test_promote_single_404_for_unknown_application(seeded_db, stub_llm):
    from api.services.calibration_service import CalibrationService
    pid, crit_id, _ = _build(seeded_db, [("a1", [1, 1])])
    with pytest.raises(ValueError, match="Application 999999 not found"):
        CalibrationService().promote_single(
            pid, crit_id, 999_999, human_score=1,
            source="operator_flagged", user_id=1,
        )


def test_promote_single_rejects_score_outside_scale(seeded_db, stub_llm):
    from api.services.calibration_service import CalibrationService
    pid, crit_id, by_ext = _build(seeded_db, [("a1", [1, 1])])
    with pytest.raises(ValueError, match="outside the criterion's"):
        CalibrationService().promote_single(
            pid, crit_id, by_ext["a1"], human_score=99,
            source="operator_flagged", user_id=1,
        )


def test_promote_single_rejects_unknown_source(seeded_db, stub_llm):
    from api.services.calibration_service import CalibrationService
    pid, crit_id, by_ext = _build(seeded_db, [("a1", [1, 1])])
    with pytest.raises(ValueError, match="Invalid source"):
        CalibrationService().promote_single(
            pid, crit_id, by_ext["a1"], human_score=1,
            source="garbage", user_id=1,
        )


# ============================================================
# Disagreements 'kind' parameter
# ============================================================


def test_disagreements_kind_filters_correctly(seeded_db, stub_llm):
    """The /disagreements endpoint's kind=agreement returns delta=0 rows;
    kind=disagreement returns delta!=0 rows; kind=all returns both."""
    from api.services.calibration_service import CalibrationService  # noqa: F401
    from api.services.disagreement_service import DisagreementService
    from db_models import (
        Iteration, IterationRepository, IterationPrompt, IterationPromptRepository,
        LlmScore, LlmScoreRepository, ScoringJob, ScoringJobRepository,
    )
    pid, crit_id, by_ext = _build(seeded_db, [
        ("a1", [1, 1]),   # human median = 1
        ("a2", [3, 3]),   # human median = 3
        ("a3", [2, 2]),   # human median = 2
    ])
    # Create a v1 iteration + prompt + completed scoring job + LLM scores
    # mimicking real data shapes.
    it_id = IterationRepository().create(Iteration(
        project_id=pid, version=1, note=None, created_by=1,
    ))
    IterationPromptRepository().bulk_upsert([
        IterationPrompt(iteration_id=it_id, criterion_id=crit_id, system_prompt="p"),
    ])
    job_id = ScoringJobRepository().create(ScoringJob(
        project_id=pid, iteration_id=it_id, split="dev", status="pending",
        progress_total=3, provider="claude", model="claude-haiku-4-5",
    ))
    ScoringJobRepository().update_status(job_id, "completed")
    # a1: LLM=1 (matches human=1 → agreement)
    # a2: LLM=1 (vs human=3 → disagreement, delta=-2)
    # a3: LLM=2 (matches human=2 → agreement)
    LlmScoreRepository().bulk_create([
        LlmScore(job_id=job_id, application_id=by_ext["a1"], criterion_id=crit_id, score=1),
        LlmScore(job_id=job_id, application_id=by_ext["a2"], criterion_id=crit_id, score=1),
        LlmScore(job_id=job_id, application_id=by_ext["a3"], criterion_id=crit_id, score=2),
    ])

    svc = DisagreementService()
    only_disag = svc.list_disagreements(pid, it_id, "dev", kind="disagreement")
    assert {r["application_external_id"] for r in only_disag} == {"a2"}

    only_agree = svc.list_disagreements(pid, it_id, "dev", kind="agreement")
    assert {r["application_external_id"] for r in only_agree} == {"a1", "a3"}
    assert all(r["delta"] == 0 for r in only_agree)

    both = svc.list_disagreements(pid, it_id, "dev", kind="all")
    assert {r["application_external_id"] for r in both} == {"a1", "a2", "a3"}


def test_disagreements_kind_invalid_raises(seeded_db, stub_llm):
    from api.services.disagreement_service import DisagreementService
    pid, crit_id, _ = _build(seeded_db, [("a1", [1, 1])])
    from db_models import Iteration, IterationRepository
    it_id = IterationRepository().create(Iteration(
        project_id=pid, version=1, note=None, created_by=1,
    ))
    with pytest.raises(ValueError, match="Invalid kind"):
        DisagreementService().list_disagreements(pid, it_id, "dev", kind="bogus")
