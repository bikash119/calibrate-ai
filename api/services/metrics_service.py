"""Agreement metrics — H-H baseline and LLM-H per iteration.

Persists everything to the generic `agreement_metrics` table:
- iteration_id NULL → H-H baseline
- iteration_id set  → LLM-H for that iteration
- criterion_id NULL → project-overall (macro-averaged across criteria)
- criterion_id set  → per-criterion
"""

import logging
import statistics as stdlib_stats
from itertools import combinations

from db_models import (
    AgreementMetric,
    AgreementMetricRepository,
    AuditLogRepository,
    CriteriaRepository,
    HumanScoreRepository,
    IterationRepository,
    LlmScoreRepository,
    ProjectRepository,
    ScoringJobRepository,
    SplitRepository,
)
from api.services.statistics_service import (
    bootstrap_qwk_ci,
    exact_agreement_rate,
    krippendorff_alpha,
    within_n_agreement_rate,
)

logger = logging.getLogger("scoring_ai.services.metrics")


class MetricsService:
    """Compute and read H-H + LLM-H agreement metrics."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.criteria_repo = CriteriaRepository()
        self.iteration_repo = IterationRepository()
        self.score_repo = LlmScoreRepository()
        self.human_repo = HumanScoreRepository()
        self.job_repo = ScoringJobRepository()
        self.split_repo = SplitRepository()
        self.metric_repo = AgreementMetricRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # H-H baseline                                                        #
    # ------------------------------------------------------------------ #

    def compute_baseline(self, project_id: int, user_id: int) -> dict:
        """Compute pairwise human-human agreement across all evaluators.

        Stored as agreement_metrics rows with iteration_id NULL, split='all'.
        Returns the freshly-computed result.
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        criteria = self.criteria_repo.get_by_project(project_id)
        if not criteria:
            raise ValueError("Project has no rubric")
        scores = self.human_repo.get_for_project(project_id)
        if not scores:
            raise ValueError("No human scores yet — upload them before computing baseline")

        # Group scores by (criterion_id, application_id) → {evaluator_id: score}
        by_crit_app: dict[int, dict[int, dict[str, int]]] = {}
        for s in scores:
            by_crit_app.setdefault(s.criterion_id, {}) \
                       .setdefault(s.application_id, {})[s.evaluator_id] = s.score

        # Track per-criterion QWK to macro-average for the project-overall row.
        per_crit_qwks: list[float] = []
        all_evaluators: set[str] = {s.evaluator_id for s in scores}

        for crit in criteria:
            crit_apps = by_crit_app.get(crit.id, {})
            scale_values = list(range(crit.scale_min, crit.scale_max + 1))

            # Build pairwise comparison arrays (every evaluator pair × every shared app).
            y1: list[int] = []
            y2: list[int] = []
            for app_id, eval_scores in crit_apps.items():
                evals = list(eval_scores.items())
                for (_, s1), (_, s2) in combinations(evals, 2):
                    y1.append(s1)
                    y2.append(s2)

            if len(y1) < 3:
                # Insufficient data — record n=0 marker
                self.metric_repo.upsert(AgreementMetric(
                    project_id=project_id, iteration_id=None, split="all",
                    criterion_id=crit.id, metric="qwk", value=None, n=len(y1),
                ))
                continue

            qwk, ci_low, ci_high = bootstrap_qwk_ci(y1, y2)
            exact = exact_agreement_rate(y1, y2)
            within1 = within_n_agreement_rate(y1, y2, 1)

            # Krippendorff's alpha needs a rater × unit matrix.
            evaluator_list = sorted(all_evaluators)
            app_list = sorted(crit_apps.keys())
            ratings = [
                [crit_apps[a].get(e) for a in app_list]
                for e in evaluator_list
            ]
            alpha = krippendorff_alpha(ratings, value_domain=scale_values)

            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=None, split="all",
                criterion_id=crit.id, metric="qwk",
                value=qwk, ci_low=ci_low, ci_high=ci_high, n=len(y1),
            ))
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=None, split="all",
                criterion_id=crit.id, metric="exact", value=exact, n=len(y1),
            ))
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=None, split="all",
                criterion_id=crit.id, metric="within_1", value=within1, n=len(y1),
            ))
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=None, split="all",
                criterion_id=crit.id, metric="krippendorff", value=alpha, n=len(y1),
            ))
            per_crit_qwks.append(qwk)

        # Project-overall: macro-average of per-criterion QWK.
        if per_crit_qwks:
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=None, split="all",
                criterion_id=None, metric="qwk",
                value=float(stdlib_stats.fmean(per_crit_qwks)),
                n=len(per_crit_qwks),
            ))

        self.audit.log("project", project_id, "baseline_computed", user_id=user_id, details={
            "criteria_count": len(criteria),
            "evaluators": sorted(all_evaluators),
        })
        logger.info("Computed H-H baseline for project %d (criteria=%d, evaluators=%d, user=%d)",
                    project_id, len(criteria), len(all_evaluators), user_id)
        return self.get_baseline(project_id)

    def get_baseline(self, project_id: int) -> dict:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        rows = self.metric_repo.get_for_project(
            project_id, iteration_id=None, split="all",
        )
        criteria = {c.id: c.name for c in self.criteria_repo.get_by_project(project_id)}
        per_criterion: list[dict] = []
        overall: list[dict] = []
        for m in rows:
            entry = _metric_to_dict(m, criteria)
            (overall if m.criterion_id is None else per_criterion).append(entry)
        evaluators = self.human_repo.get_evaluator_ids_for_project(project_id)
        return {
            "project_id": project_id,
            "per_criterion": per_criterion,
            "overall": overall,
            "evaluator_count": len(evaluators),
        }

    # ------------------------------------------------------------------ #
    # LLM-H per iteration                                                 #
    # ------------------------------------------------------------------ #

    def compute_iteration_metrics(
        self,
        project_id: int,
        iteration_id: int,
        split: str,
        user_id: int,
    ) -> dict:
        """Compare LLM scores from the latest completed (iteration, split) job
        against the human median for each application × criterion."""
        iteration = self.iteration_repo.get_by_id(iteration_id)
        if not iteration or iteration.project_id != project_id:
            raise ValueError(f"Iteration {iteration_id} not found in project {project_id}")
        if split not in ("dev", "validation", "test"):
            raise ValueError(f"Invalid split '{split}' for LLM-H metrics")

        jobs = [
            j for j in self.job_repo.get_by_iteration(iteration_id)
            if j.split == split and j.status == "completed"
        ]
        if not jobs:
            raise ValueError(
                f"No completed {split}-split scoring job for iteration {iteration_id}"
            )
        latest = max(jobs, key=lambda j: j.completed_at or j.created_at or "")

        criteria = self.criteria_repo.get_by_project(project_id)
        crit_by_id = {c.id: c for c in criteria}
        if not crit_by_id:
            raise ValueError("Project has no rubric")

        llm_scores = self.score_repo.get_for_job(latest.id)
        if not llm_scores:
            raise ValueError(f"Job {latest.id} has no scores")

        split_app_ids = set(self.split_repo.get_application_ids(project_id, split))
        # Build {(app_id, crit_id): llm_score} restricted to the split
        llm_by_pair: dict[tuple[int, int], int] = {}
        for s in llm_scores:
            if s.application_id in split_app_ids:
                llm_by_pair[(s.application_id, s.criterion_id)] = s.score

        # Build {(app_id, crit_id): median_human_score} from human_scores
        human_groups: dict[tuple[int, int], list[int]] = {}
        for hs in self.human_repo.get_for_project(project_id):
            if hs.application_id in split_app_ids:
                human_groups.setdefault((hs.application_id, hs.criterion_id), []).append(hs.score)
        median_by_pair: dict[tuple[int, int], int] = {
            k: int(round(stdlib_stats.median(v)))
            for k, v in human_groups.items()
        }

        per_crit_qwks: list[float] = []
        for crit in criteria:
            llm_for_crit: list[int] = []
            human_for_crit: list[int] = []
            for (aid, cid), llm_score in llm_by_pair.items():
                if cid != crit.id:
                    continue
                med = median_by_pair.get((aid, cid))
                if med is None:
                    continue
                llm_for_crit.append(llm_score)
                human_for_crit.append(med)

            n = len(llm_for_crit)
            if n < 3:
                self.metric_repo.upsert(AgreementMetric(
                    project_id=project_id, iteration_id=iteration_id, split=split,
                    criterion_id=crit.id, metric="qwk", value=None, n=n,
                ))
                continue

            qwk, ci_low, ci_high = bootstrap_qwk_ci(llm_for_crit, human_for_crit)
            exact = exact_agreement_rate(llm_for_crit, human_for_crit)
            within1 = within_n_agreement_rate(llm_for_crit, human_for_crit, 1)

            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=iteration_id, split=split,
                criterion_id=crit.id, metric="qwk",
                value=qwk, ci_low=ci_low, ci_high=ci_high, n=n,
            ))
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=iteration_id, split=split,
                criterion_id=crit.id, metric="exact", value=exact, n=n,
            ))
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=iteration_id, split=split,
                criterion_id=crit.id, metric="within_1", value=within1, n=n,
            ))
            per_crit_qwks.append(qwk)

        if per_crit_qwks:
            self.metric_repo.upsert(AgreementMetric(
                project_id=project_id, iteration_id=iteration_id, split=split,
                criterion_id=None, metric="qwk",
                value=float(stdlib_stats.fmean(per_crit_qwks)),
                n=len(per_crit_qwks),
            ))

        self.audit.log("iteration", iteration_id, "metrics_computed", user_id=user_id, details={
            "split": split, "job_id": latest.id,
        })
        logger.info("Computed LLM-H metrics for iteration %d split=%s (job=%d, user=%d)",
                    iteration_id, split, latest.id, user_id)
        return self.get_iteration_metrics(project_id, iteration_id, split)

    def get_iteration_metrics(
        self, project_id: int, iteration_id: int, split: str
    ) -> dict:
        rows = self.metric_repo.get_for_project(
            project_id, iteration_id=iteration_id, split=split,
        )
        criteria = {c.id: c.name for c in self.criteria_repo.get_by_project(project_id)}
        per_criterion: list[dict] = []
        overall: list[dict] = []
        for m in rows:
            entry = _metric_to_dict(m, criteria)
            (overall if m.criterion_id is None else per_criterion).append(entry)
        return {
            "project_id": project_id,
            "iteration_id": iteration_id,
            "split": split,
            "per_criterion": per_criterion,
            "overall": overall,
        }


def _metric_to_dict(m: AgreementMetric, crit_name_by_id: dict[int, str]) -> dict:
    return {
        "project_id": m.project_id,
        "iteration_id": m.iteration_id,
        "split": m.split,
        "criterion_id": m.criterion_id,
        "criterion_name": crit_name_by_id.get(m.criterion_id) if m.criterion_id else None,
        "metric": m.metric,
        "value": m.value,
        "ci_low": m.ci_low,
        "ci_high": m.ci_high,
        "n": m.n,
        "computed_at": m.computed_at,
    }
