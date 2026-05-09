"""Scoring jobs — sequential LLM scoring with progress tracking.

For MVP this is one LLM call per (application × criterion), executed in a
background task. Batch APIs (Gemini Vertex Batch, Anthropic Message Batches)
land in a later pass.
"""

import json
import logging
import os
from typing import Iterable

from db_models import (
    ApplicationRepository,
    AuditLogRepository,
    CriteriaRepository,
    IterationPromptRepository,
    IterationRepository,
    LlmScore,
    LlmScoreRepository,
    ProjectRepository,
    QuestionRepository,
    ScoringJob,
    ScoringJobRepository,
    SplitRepository,
)
from llm_client import DEFAULT_PROVIDER, default_model_for, get_llm_client
from prompts import build_user_prompt

logger = logging.getLogger("scoring_ai.services.scoring_job")


class ScoringJobService:
    """Submit, query, and run sequential scoring jobs."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.iteration_repo = IterationRepository()
        self.prompt_repo = IterationPromptRepository()
        self.criteria_repo = CriteriaRepository()
        self.question_repo = QuestionRepository()
        self.app_repo = ApplicationRepository()
        self.split_repo = SplitRepository()
        self.score_repo = LlmScoreRepository()
        self.job_repo = ScoringJobRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Submit                                                              #
    # ------------------------------------------------------------------ #

    def submit(
        self,
        project_id: int,
        iteration_id: int,
        split: str,
        provider: str | None,
        model: str | None,
        user_id: int,
    ) -> int:
        """Create a job in 'pending' state. The background runner picks it up next.

        Validity guards:
        - split must have applications
        - test split cannot be re-scored once any test job has completed
        - cannot run a new job if one is already running for (iteration, split)
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        iteration = self.iteration_repo.get_by_id(iteration_id)
        if not iteration or iteration.project_id != project_id:
            raise ValueError(f"Iteration {iteration_id} not found in project {project_id}")
        if split not in ("dev", "validation", "test", "production"):
            raise ValueError(f"Invalid split '{split}'")

        existing = self.job_repo.get_by_iteration(iteration_id)
        if any(j.split == split and j.status in ("pending", "running") for j in existing):
            raise ValueError(
                f"A {split}-split job is already pending/running for iteration {iteration_id}"
            )
        if split == "test":
            project_jobs = self.job_repo.get_by_project(project_id)
            if any(j.split == "test" and j.status == "completed" for j in project_jobs):
                raise ValueError(
                    "Test split has already been scored once. Cannot re-score test "
                    "without compromising validity — clone the project to start over."
                )

        # Determine which apps to score
        if split == "production":
            app_ids = self.app_repo.get_ids_by_project(project_id)
        else:
            app_ids = self.split_repo.get_application_ids(project_id, split)
        if not app_ids:
            raise ValueError(f"No applications in '{split}' split. Generate splits first.")

        criteria = self.criteria_repo.get_by_project(project_id)
        if not criteria:
            raise ValueError("Project has no rubric")

        chosen_provider = (
            provider or os.environ.get("LLM_PROVIDER", DEFAULT_PROVIDER)
        ).lower()
        chosen_model = model or default_model_for(chosen_provider)

        job_id = self.job_repo.create(ScoringJob(
            project_id=project_id,
            iteration_id=iteration_id,
            split=split,
            status="pending",
            progress_total=len(app_ids) * len(criteria),
            provider=chosen_provider,
            model=chosen_model,
        ))
        self.audit.log("scoring_job", job_id, "submitted", user_id=user_id, details={
            "project_id": project_id,
            "iteration_id": iteration_id,
            "split": split,
            "apps": len(app_ids),
            "criteria": len(criteria),
            "provider": chosen_provider,
            "model": chosen_model,
        })
        logger.info(
            "Submitted scoring job %d (project=%d, iteration=%d, split=%s, %d×%d=%d calls)",
            job_id, project_id, iteration_id, split,
            len(app_ids), len(criteria), len(app_ids) * len(criteria),
        )
        return job_id

    # ------------------------------------------------------------------ #
    # Read paths                                                          #
    # ------------------------------------------------------------------ #

    def list_for_project(self, project_id: int) -> list[dict]:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        jobs = self.job_repo.get_by_project(project_id)
        if not jobs:
            return []
        # Resolve iteration versions for display
        version_by_iter = {}
        for it in self.iteration_repo.get_by_project(project_id):
            version_by_iter[it.id] = it.version
        return [
            {
                "id": j.id,
                "project_id": j.project_id,
                "iteration_id": j.iteration_id,
                "iteration_version": version_by_iter.get(j.iteration_id, 0),
                "split": j.split,
                "status": j.status,
                "progress_total": j.progress_total,
                "progress_current": j.progress_current,
                "provider": j.provider,
                "model": j.model,
                "cost_estimate_usd": j.cost_estimate_usd,
                "cost_actual_usd": j.cost_actual_usd,
                "started_at": j.started_at,
                "completed_at": j.completed_at,
                "created_at": j.created_at,
            }
            for j in jobs
        ]

    def get_status(self, job_id: int) -> dict:
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Scoring job {job_id} not found")
        return {
            "id": job.id,
            "status": job.status,
            "progress_total": job.progress_total,
            "progress_current": job.progress_current,
            "error_message": job.error_message,
            "cost_actual_usd": job.cost_actual_usd,
        }

    def get_scores(self, job_id: int) -> list[dict]:
        """Return llm_scores for a job, joined with app + criterion names for display."""
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Scoring job {job_id} not found")

        scores = self.score_repo.get_for_job(job_id)
        if not scores:
            return []

        # Resolve display names in two queries
        app_external_by_id = {
            a.id: a.external_id for a in self.app_repo.get_by_project(job.project_id)
        }
        crit_name_by_id = {
            c.id: c.name for c in self.criteria_repo.get_by_project(job.project_id)
        }
        return [
            {
                "job_id": s.job_id,
                "application_id": s.application_id,
                "application_external_id": app_external_by_id.get(s.application_id, "(unknown)"),
                "criterion_id": s.criterion_id,
                "criterion_name": crit_name_by_id.get(s.criterion_id, "(unknown)"),
                "score": s.score,
                "reasoning": s.reasoning,
                "created_at": s.created_at,
            }
            for s in scores
        ]

    def cancel(self, job_id: int, user_id: int) -> None:
        job = self.job_repo.get_by_id(job_id)
        if not job:
            raise ValueError(f"Scoring job {job_id} not found")
        if job.status not in ("pending", "running"):
            raise ValueError(f"Cannot cancel a {job.status} job")
        self.job_repo.update_status(job_id, "cancelled")
        self.audit.log("scoring_job", job_id, "cancelled", user_id=user_id)


# ============================================================
# Background runner — invoked via FastAPI BackgroundTasks
# ============================================================


def run_scoring_job(job_id: int) -> None:
    """Sequential per-criterion scoring loop. Updates progress as it goes."""
    job_repo = ScoringJobRepository()
    job = job_repo.get_by_id(job_id)
    if not job:
        logger.error("run_scoring_job: job %d not found", job_id)
        return
    if job.status == "cancelled":
        return

    project_repo = ProjectRepository()
    project = project_repo.get_by_id(job.project_id)
    if not project:
        job_repo.update_status(job_id, "failed", error_message=f"Project {job.project_id} disappeared")
        return

    iter_prompt_repo = IterationPromptRepository()
    prompts_by_crit = iter_prompt_repo.get_as_dict(job.iteration_id)

    criteria_repo = CriteriaRepository()
    criteria = criteria_repo.get_by_project(job.project_id)
    if not criteria:
        job_repo.update_status(job_id, "failed", error_message="Project has no rubric")
        return

    question_repo = QuestionRepository()
    questions = question_repo.get_by_project(job.project_id)
    questions_by_key = {q.key: q for q in questions}

    app_repo = ApplicationRepository()
    split_repo = SplitRepository()
    score_repo = LlmScoreRepository()

    if job.split == "production":
        app_ids = app_repo.get_ids_by_project(job.project_id)
    else:
        app_ids = split_repo.get_application_ids(job.project_id, job.split)
    apps_by_id = {a.id: a for a in app_repo.get_by_project(job.project_id) if a.id in set(app_ids)}

    job_repo.update_status(job_id, "running")
    logger.info("Job %d running: %d apps × %d criteria", job_id, len(app_ids), len(criteria))

    try:
        # Honor the provider/model the job was created with, not whatever
        # the env var happens to be at worker-call time. This is what makes
        # the recorded `job.provider` / `job.model` match what the worker
        # actually calls.
        client = get_llm_client(provider=job.provider, model=job.model)
        progress = 0
        for aid in app_ids:
            app = apps_by_id.get(aid)
            if app is None:
                continue
            # Re-check cancellation between applications
            if job_repo.get_by_id(job_id).status == "cancelled":
                logger.info("Job %d cancelled mid-run at progress %d", job_id, progress)
                return

            for crit in criteria:
                system_prompt = prompts_by_crit.get(crit.id)
                if system_prompt is None:
                    raise RuntimeError(f"Iteration is missing a prompt for criterion {crit.id}")
                user_prompt = build_user_prompt(crit, app, questions_by_key)
                response = client.score(system_prompt, user_prompt)
                score_int = int(response.get("score", crit.scale_min))
                # Clamp to scale
                score_int = max(crit.scale_min, min(crit.scale_max, score_int))
                score_repo.create(LlmScore(
                    job_id=job_id,
                    application_id=app.id,
                    criterion_id=crit.id,
                    score=score_int,
                    reasoning=response.get("reasoning", ""),
                    raw_response=json.dumps(response, ensure_ascii=False),
                ))
                progress += 1
                job_repo.update_progress(job_id, progress)

        job_repo.update_status(job_id, "completed")
        logger.info("Job %d completed (%d scores)", job_id, progress)

    except Exception as e:
        logger.exception("Job %d failed: %s", job_id, e)
        job_repo.update_status(job_id, "failed", error_message=str(e))


# Provider/model defaults moved to `llm_client.default_model_for` so the
# value recorded on the job and the value the worker actually calls share
# one source of truth.
