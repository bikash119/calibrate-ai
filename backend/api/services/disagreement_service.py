"""Disagreement triage — find LLM-H mismatches and let operators flag them.

For an iteration, we surface the (application, criterion) pairs where the LLM
score from the latest completed scoring job differs from the human median.
Operators tag each one as 'llm_correct' / 'human_correct' / 'ambiguous';
flags survive across iterations (they're per-project, not per-iteration).
"""

import json
import logging
import statistics as stdlib_stats

from db_models import (
    ApplicationRepository,
    AuditLogRepository,
    CriteriaRepository,
    DisagreementFlag,
    DisagreementFlagRepository,
    HumanScoreRepository,
    IterationRepository,
    LlmScoreRepository,
    ProjectRepository,
    QuestionRepository,
    ScoringJobRepository,
    SplitRepository,
)

logger = logging.getLogger("scoring_ai.services.disagreement")

EXCERPT_MAX_CHARS = 240


class DisagreementService:
    """Build the disagreement feed and manage flags."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.iteration_repo = IterationRepository()
        self.criteria_repo = CriteriaRepository()
        self.question_repo = QuestionRepository()
        self.app_repo = ApplicationRepository()
        self.split_repo = SplitRepository()
        self.score_repo = LlmScoreRepository()
        self.human_repo = HumanScoreRepository()
        self.job_repo = ScoringJobRepository()
        self.flag_repo = DisagreementFlagRepository()
        self.audit = AuditLogRepository()

    def list_disagreements(
        self,
        project_id: int,
        iteration_id: int,
        split: str = "dev",
        *,
        kind: str = "disagreement",
    ) -> list[dict]:
        """Return scoring-comparison entries sorted by abs(delta) descending.

        `kind` controls which rows are returned:
          - 'disagreement' (default, legacy): delta != 0 only.
          - 'agreement': delta == 0 only — used by the SelectExamplesModal
            so the operator can promote LLM-correct cases as positive
            anchors in v(N+1)'s prompt.
          - 'all': both, in one list.
        """
        iteration = self.iteration_repo.get_by_id(iteration_id)
        if not iteration or iteration.project_id != project_id:
            raise ValueError(f"Iteration {iteration_id} not found in project {project_id}")
        if split not in ("dev", "validation", "test"):
            raise ValueError(f"Invalid split '{split}'")
        if kind not in ("disagreement", "agreement", "all"):
            raise ValueError(
                f"Invalid kind '{kind}'. Use 'disagreement', 'agreement', or 'all'."
            )

        # Latest completed (iteration, split) job
        jobs = [
            j for j in self.job_repo.get_by_iteration(iteration_id)
            if j.split == split and j.status == "completed"
        ]
        if not jobs:
            return []
        latest = max(jobs, key=lambda j: j.completed_at or j.created_at or "")

        # All the data
        criteria_by_id = {c.id: c for c in self.criteria_repo.get_by_project(project_id)}
        apps_by_id = {a.id: a for a in self.app_repo.get_by_project(project_id)}
        questions_by_key = {q.key: q for q in self.question_repo.get_by_project(project_id)}
        split_app_ids = set(self.split_repo.get_application_ids(project_id, split))

        # Aggregate human scores → median + raw list per (app, crit)
        human_groups: dict[tuple[int, int], list[int]] = {}
        for hs in self.human_repo.get_for_project(project_id):
            if hs.application_id in split_app_ids:
                human_groups.setdefault((hs.application_id, hs.criterion_id), []).append(hs.score)

        # Existing flags
        flags_by_pair: dict[tuple[int, int], str] = {
            (f.application_id, f.criterion_id): f.flag
            for f in self.flag_repo.get_for_project(project_id)
        }

        disagreements: list[dict] = []
        for s in self.score_repo.get_for_job(latest.id):
            if s.application_id not in split_app_ids:
                continue
            humans = human_groups.get((s.application_id, s.criterion_id))
            if not humans:
                continue   # no human comparison available
            median = float(stdlib_stats.median(humans))
            delta = float(s.score) - median
            if kind == "disagreement" and delta == 0:
                continue   # caller wants only divergences
            if kind == "agreement" and delta != 0:
                continue   # caller wants only LLM-correct cases

            crit = criteria_by_id.get(s.criterion_id)
            if not crit:
                continue
            app = apps_by_id.get(s.application_id)
            if not app:
                continue

            disagreements.append({
                "application_id": s.application_id,
                "application_external_id": app.external_id,
                "criterion_id": s.criterion_id,
                "criterion_name": crit.name,
                "llm_score": s.score,
                "human_median": median,
                "human_individual_scores": sorted(humans),
                "delta": delta,
                "excerpt": _excerpt_for(crit, app, questions_by_key),
                "llm_reasoning": s.reasoning,
                "flag": flags_by_pair.get((s.application_id, s.criterion_id)),
            })

        disagreements.sort(key=lambda d: abs(d["delta"]), reverse=True)
        return disagreements

    def upsert_flag(
        self,
        project_id: int,
        application_id: int,
        criterion_id: int,
        flag: str,
        user_id: int,
    ) -> None:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        if flag not in ("llm_correct", "human_correct", "ambiguous"):
            raise ValueError(f"Invalid flag '{flag}'")
        # Sanity: app and criterion belong to the project
        app = self.app_repo.get_by_id(application_id)
        if not app or app.project_id != project_id:
            raise ValueError(f"Application {application_id} not found in project {project_id}")
        crit = self.criteria_repo.get_by_id(criterion_id)
        if not crit or crit.project_id != project_id:
            raise ValueError(f"Criterion {criterion_id} not found in project {project_id}")

        self.flag_repo.upsert(DisagreementFlag(
            project_id=project_id,
            application_id=application_id,
            criterion_id=criterion_id,
            flag=flag,
            flagged_by=user_id,
        ))
        self.audit.log("project", project_id, "disagreement_flagged", user_id=user_id, details={
            "application_id": application_id, "criterion_id": criterion_id, "flag": flag,
        })

    def counts_by_flag(self, project_id: int) -> dict[str, int]:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        return self.flag_repo.count_by_flag(project_id)


def _excerpt_for(crit, app, questions_by_key) -> str:
    """First-feeding-question answer, truncated. Best-effort — empty string on miss."""
    feeding_keys = json.loads(crit.feeding_question_keys_json or "[]")
    answers = json.loads(app.answers_json or "{}")
    for key in feeding_keys:
        ans = answers.get(key)
        if ans:
            text = str(ans).strip()
            if len(text) > EXCERPT_MAX_CHARS:
                text = text[:EXCERPT_MAX_CHARS - 1] + "…"
            return text
    return ""
