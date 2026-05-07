"""Demo project seeder — populates a working calibration example in one click.

Useful for onboarding new operators who want to see the full loop run before
committing real data. Creates a generic "application quality" rubric with one
criterion, 10 sample applications with varied quality, and two evaluators with
realistic ±1 noise.
"""

import json
import logging
import random

from db_models import (
    Application,
    ApplicationRepository,
    AuditLogRepository,
    Criterion,
    CriteriaRepository,
    HumanScore,
    HumanScoreRepository,
    Project,
    ProjectRepository,
    Question,
    QuestionRepository,
)

logger = logging.getLogger("scoring_ai.services.demo")


# ------------------------------------------------------------------ #
# Hardcoded fixture                                                   #
# ------------------------------------------------------------------ #


_RUBRIC = {
    "name": "clarity",
    "description": "How clearly does the application articulate the project, the problem, and the team?",
    "scale_min": 1,
    "scale_max": 3,
    "anchors": {
        "1": "Vague claims, no specifics. The reader cannot tell what is being proposed or why.",
        "2": "Generally clear but missing specifics on at least one of: scope, evidence, or differentiation.",
        "3": "Crisp and specific throughout: concrete project, named evidence, clear differentiation.",
    },
    "feeding_keys": ["q1", "q2", "q3"],
    "weighted_keys": ["q1"],
}

_QUESTIONS = [
    {"key": "q1", "text": "Describe your project in one paragraph."},
    {"key": "q2", "text": "What problem are you solving, and for whom?"},
    {"key": "q3", "text": "What makes you uniquely positioned to solve it?"},
]

# Each (external_id, score, answers) — score is what humans should land on.
# Apps span the full 1-3 scale with two examples per score for diversity.
_APPLICATIONS = [
    (
        "demo-001", 3,
        {
            "q1": "We're building a CO2-monitoring kit for primary schools that posts the data to a parent-facing dashboard. Hardware is a $30 sensor + Raspberry Pi; software runs on Vercel.",
            "q2": "Indoor air quality in primary schools is a documented driver of cognitive performance and absenteeism. Our customer is the school district administrator; the user is the classroom teacher.",
            "q3": "Our co-founder spent 6 years at the EPA on indoor-air-quality monitoring. We've already piloted in 4 schools across the New Haven district.",
        },
    ),
    (
        "demo-002", 3,
        {
            "q1": "AskAlma is a peer-tutoring marketplace for Spanish-speaking community college students. Tutors are vetted by GPA + a 30-minute screening; sessions are 50 minutes for $15.",
            "q2": "Hispanic CC students have a 41% completion rate vs 64% for non-Hispanic; lack of culturally-aware tutoring is one cited factor. We serve students; we sell to colleges via Title V funds.",
            "q3": "Founder is a first-gen college grad and former CC tutor with 200+ hours of one-on-one experience. We've run a 30-student pilot at LACC and saw a 22-point grade-distribution shift.",
        },
    ),
    (
        "demo-003", 2,
        {
            "q1": "We're making a wellness app for office workers. It does breathing exercises, mood tracking, and team challenges.",
            "q2": "Office workers report high stress. Our customers are HR teams; users are employees.",
            "q3": "Founder has worked in a few startups and has empathy for the problem.",
        },
    ),
    (
        "demo-004", 2,
        {
            "q1": "DataCanvas is a no-code analytics platform for small e-commerce stores. Connect Shopify, get dashboards.",
            "q2": "Small Shopify merchants don't use the data they collect. We'd target stores doing $100K-$2M GMV.",
            "q3": "We've talked to 30 merchants and they've expressed interest. Looking for product/market fit.",
        },
    ),
    (
        "demo-005", 1,
        {
            "q1": "AI for everyone. Our platform helps companies leverage artificial intelligence.",
            "q2": "Many companies want AI but don't know how. We help.",
            "q3": "We have a strong team and are passionate about AI.",
        },
    ),
    (
        "demo-006", 1,
        {
            "q1": "We're disrupting the food industry.",
            "q2": "Food is broken. We fix it.",
            "q3": "We have great ideas and we work hard.",
        },
    ),
    (
        "demo-007", 3,
        {
            "q1": "RubricCraft is a SaaS that helps grant programs design defensible scoring rubrics. Customers upload past applications and human scores; we surface ambiguity in the rubric and suggest revisions.",
            "q2": "Grant programs spend $4-12B annually that's allocated by humans using ad-hoc rubrics. Customer: program managers at foundations and gov't agencies. Average ARR target $30K.",
            "q3": "Our co-founder ran the Robin Hood Foundation's grants office for 7 years. We've consulted with the Knight Foundation and Gates on this exact problem.",
        },
    ),
    (
        "demo-008", 2,
        {
            "q1": "GreenTrace is a carbon accounting tool for small construction firms. Track emissions per project, generate compliance reports.",
            "q2": "Small construction firms (under 50 employees) struggle with new state emissions reporting requirements. We're targeting California and Washington first.",
            "q3": "One co-founder is a structural engineer; we have early customer letters from 3 firms. Domain expertise but no prior software experience.",
        },
    ),
    (
        "demo-009", 1,
        {
            "q1": "Health is wealth. Our app makes you healthier.",
            "q2": "Everyone wants to be healthy.",
            "q3": "We are committed.",
        },
    ),
    (
        "demo-010", 3,
        {
            "q1": "Hopper is a low-cost remote-physiotherapy platform — a 30-minute video call with a licensed PT, plus weekly progress photos analyzed by a CV model. $40/session vs $120 for in-person.",
            "q2": "30M Americans need physiotherapy annually but 60% live further than 30 minutes from a clinic. We're targeting Medicaid populations in rural Appalachia first.",
            "q3": "Founder is a licensed PT with 10 years in rural clinics. CTO is ex-Google CV; we have an existing model achieving 84% accuracy on range-of-motion estimation from a phone camera.",
        },
    ),
]


# ------------------------------------------------------------------ #
# Seeder                                                              #
# ------------------------------------------------------------------ #


class DemoService:
    """Creates a fully-populated demo project ready for the calibration loop."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.question_repo = QuestionRepository()
        self.criteria_repo = CriteriaRepository()
        self.app_repo = ApplicationRepository()
        self.human_repo = HumanScoreRepository()
        self.audit = AuditLogRepository()

    def create_demo_project(self, program_id: int, user_id: int) -> int:
        """Create + seed. Returns the new project ID."""
        project_id = self.project_repo.create(Project(
            program_id=program_id,
            name=f"Demo project ({_short_random()})",
            description="Pre-populated example: a 1-criterion rubric with 10 applications and 2 evaluators. Score it on dev to see the calibration loop end-to-end.",
            language="en",
            state="setup",
            random_seed=random.randint(0, 2**31 - 1),
            created_by=user_id,
        ))

        # Questions
        self.question_repo.replace_all(project_id, [
            Question(
                project_id=project_id, key=q["key"], text=q["text"],
                sort_order=i,
            )
            for i, q in enumerate(_QUESTIONS)
        ])

        # Rubric (one criterion)
        self.criteria_repo.replace_all(project_id, [
            Criterion(
                project_id=project_id,
                name=_RUBRIC["name"],
                description=_RUBRIC["description"],
                scale_min=_RUBRIC["scale_min"],
                scale_max=_RUBRIC["scale_max"],
                anchor_descriptions_json=json.dumps(_RUBRIC["anchors"]),
                feeding_question_keys_json=json.dumps(_RUBRIC["feeding_keys"]),
                weighted_question_keys_json=json.dumps(_RUBRIC["weighted_keys"]),
                sort_order=0,
            ),
        ])
        crit_id = self.criteria_repo.get_by_project(project_id)[0].id

        # Applications
        app_records = self.app_repo.bulk_create([
            Application(
                project_id=project_id,
                external_id=ext_id,
                answers_json=json.dumps(answers, ensure_ascii=False),
            )
            for (ext_id, _, answers) in _APPLICATIONS
        ])
        app_id_by_ext = {
            a.external_id: a.id
            for a in self.app_repo.get_by_project(project_id)
        }

        # Human scores: 2 evaluators, alice = exactly the target, bob = ±1 noise
        # alternating direction so the evaluator pair has visible disagreement.
        rng = random.Random(0)   # Deterministic so tests can rely on it
        score_rows: list[HumanScore] = []
        for i, (ext_id, target, _) in enumerate(_APPLICATIONS):
            aid = app_id_by_ext[ext_id]
            score_rows.append(HumanScore(
                application_id=aid, criterion_id=crit_id,
                evaluator_id="alice", score=target,
            ))
            # Bob deviates ±1 on alternating rows; clamped to scale.
            offset = 1 if i % 2 == 0 else -1
            bob_score = max(_RUBRIC["scale_min"], min(_RUBRIC["scale_max"], target + offset))
            score_rows.append(HumanScore(
                application_id=aid, criterion_id=crit_id,
                evaluator_id="bob", score=bob_score,
            ))
        self.human_repo.bulk_create(score_rows)

        self.audit.log("project", project_id, "created_from_demo", user_id=user_id, details={
            "applications": len(_APPLICATIONS),
            "evaluators": 2,
            "criterion_count": 1,
        })
        logger.info(
            "Created demo project %d (program=%d, user=%d) — %d apps, %d criteria",
            project_id, program_id, user_id, len(app_records), 1,
        )
        return project_id


def _short_random() -> str:
    """Six-char suffix so multiple demos can coexist (e.g. 'a3f29c')."""
    import secrets
    return secrets.token_hex(3)
