"""Demo project seeder — basic shape + statelessness."""

import json

from db_models import (
    ApplicationRepository,
    CriteriaRepository,
    HumanScoreRepository,
    QuestionRepository,
)


def test_demo_project_has_complete_shape(seeded_db):
    from api.services.demo_service import DemoService
    pid = DemoService().create_demo_project(program_id=1, user_id=1)

    questions = QuestionRepository().get_by_project(pid)
    assert {q.key for q in questions} == {"q1", "q2", "q3"}

    crits = CriteriaRepository().get_by_project(pid)
    assert len(crits) == 1
    assert crits[0].name == "clarity"
    assert crits[0].scale_min == 1 and crits[0].scale_max == 3
    anchors = json.loads(crits[0].anchor_descriptions_json)
    assert set(anchors.keys()) == {"1", "2", "3"}

    apps = ApplicationRepository().get_by_project(pid)
    assert len(apps) == 10
    # Each app's answers cover all three feeding questions
    for a in apps:
        answers = json.loads(a.answers_json)
        assert set(answers.keys()) == {"q1", "q2", "q3"}

    scores = HumanScoreRepository().get_for_project(pid)
    # 2 evaluators × 10 applications × 1 criterion
    assert len(scores) == 20
    evaluator_ids = {s.evaluator_id for s in scores}
    assert evaluator_ids == {"alice", "bob"}


def test_demo_project_is_distinguishable_per_call(seeded_db):
    from api.services.demo_service import DemoService
    p1 = DemoService().create_demo_project(program_id=1, user_id=1)
    p2 = DemoService().create_demo_project(program_id=1, user_id=1)
    assert p1 != p2


def test_demo_project_audit_records_origin(seeded_db):
    from api.services.audit_service import AuditService
    from api.services.demo_service import DemoService

    pid = DemoService().create_demo_project(program_id=1, user_id=1)
    entries = AuditService().get_for_entity("project", pid)
    actions = [e["action"] for e in entries]
    assert "created_from_demo" in actions
