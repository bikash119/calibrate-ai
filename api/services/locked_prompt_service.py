"""Locked prompts — the immutable artifact at the end of calibration.

Locking takes a project in 'test_run_complete' state and snapshots its rubric,
its latest iteration's prompts, its active calibration examples, and its
test-split metrics into a self-contained record. The project transitions
to 'locked' atomically.

The snapshot is intentionally redundant: even if the project is later deleted
or the rubric edited (impossible in practice — locked → archived only —
but safe by FK), the locked record stands alone.
"""

import hashlib
import json
import logging

from db_models import (
    AgreementMetricRepository,
    AuditLogRepository,
    CalibrationExampleRepository,
    CriteriaRepository,
    IterationPromptRepository,
    IterationRepository,
    LockedPrompt,
    LockedPromptRepository,
    ProjectRepository,
    ScoringJobRepository,
)

logger = logging.getLogger("scoring_ai.services.locked_prompt")


class LockedPromptService:
    """Build, list, and read the immutable locked-prompt artifact."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.criteria_repo = CriteriaRepository()
        self.iteration_repo = IterationRepository()
        self.iter_prompt_repo = IterationPromptRepository()
        self.example_repo = CalibrationExampleRepository()
        self.metric_repo = AgreementMetricRepository()
        self.job_repo = ScoringJobRepository()
        self.locked_repo = LockedPromptRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Lock                                                                #
    # ------------------------------------------------------------------ #

    def lock(self, project_id: int, name: str, user_id: int) -> int:
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        if project.state != "test_run_complete":
            raise ValueError(
                f"Project must be in state 'test_run_complete' to lock; current state is '{project.state}'"
            )
        if not name or not name.strip():
            raise ValueError("Locked prompt name is required")

        iteration = self.iteration_repo.get_latest(project_id)
        if not iteration:
            raise ValueError("Project has no iterations to lock")

        criteria = self.criteria_repo.get_by_project(project_id)
        if not criteria:
            raise ValueError("Project has no rubric")

        prompts_dict = self.iter_prompt_repo.get_as_dict(iteration.id)
        if len(prompts_dict) != len(criteria):
            raise ValueError(
                f"Iteration {iteration.id} is missing prompts for some criteria "
                f"({len(prompts_dict)}/{len(criteria)})"
            )

        # Find the test-split scoring job that produced the locking metrics.
        test_jobs = [
            j for j in self.job_repo.get_by_iteration(iteration.id)
            if j.split == "test" and j.status == "completed"
        ]
        if not test_jobs:
            raise ValueError(
                "No completed test-split scoring job found. Run test scoring before locking."
            )
        latest_test_job = max(test_jobs, key=lambda j: j.completed_at or j.created_at or "")

        # Build snapshots
        rubric_snapshot = _rubric_snapshot(criteria)
        prompts_snapshot = _prompts_snapshot(prompts_dict, criteria)
        examples_snapshot = _examples_snapshot(self.example_repo, project_id)
        test_metrics = _test_metrics_snapshot(self.metric_repo, project_id, iteration.id)

        # Hash the prompts for integrity verification
        prompt_hash = hashlib.sha256(
            json.dumps(prompts_snapshot, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()

        locked_id = self.locked_repo.create(LockedPrompt(
            project_id=project_id,
            iteration_id=iteration.id,
            name=name,
            rubric_snapshot_json=json.dumps(rubric_snapshot, ensure_ascii=False),
            prompts_snapshot_json=json.dumps(prompts_snapshot, ensure_ascii=False),
            examples_snapshot_json=json.dumps(examples_snapshot, ensure_ascii=False) if examples_snapshot else None,
            prompt_hash=prompt_hash,
            test_metrics_json=json.dumps(test_metrics, ensure_ascii=False),
            provider=latest_test_job.provider,
            model=latest_test_job.model,
            locked_by=user_id,
        ))

        # Atomically transition project state. ProjectRepository.update_state doesn't
        # validate transitions, so we do it via the same path the project_service uses
        # — but we accept the duplication: this lock operation is itself the gate.
        self.project_repo.update_state(project_id, "locked")

        self.audit.log("locked_prompt", locked_id, "created", user_id=user_id, details={
            "project_id": project_id,
            "iteration_id": iteration.id,
            "iteration_version": iteration.version,
            "name": name,
            "prompt_hash": prompt_hash,
            "provider": latest_test_job.provider,
            "model": latest_test_job.model,
        })
        logger.info("Locked project %d as locked_prompt %d (iteration v%d, hash=%s)",
                    project_id, locked_id, iteration.version, prompt_hash[:8])
        return locked_id

    # ------------------------------------------------------------------ #
    # Read paths                                                          #
    # ------------------------------------------------------------------ #

    def list_all(self) -> list[dict]:
        rows = self.locked_repo.get_all()
        return [_locked_to_summary(r) for r in rows]

    def get_detail(self, locked_id: int) -> dict:
        lp = self.locked_repo.get_by_id(locked_id)
        if not lp:
            raise ValueError(f"Locked prompt {locked_id} not found")
        return _locked_to_detail(lp)


# ============================================================
# Snapshot builders
# ============================================================


def _rubric_snapshot(criteria) -> list[dict]:
    """Capture criteria with anchors, scales, and feeding-question keys."""
    return [
        {
            "id": c.id,
            "name": c.name,
            "description": c.description,
            "scale_min": c.scale_min,
            "scale_max": c.scale_max,
            "anchor_descriptions": json.loads(c.anchor_descriptions_json or "{}"),
            "feeding_question_keys": json.loads(c.feeding_question_keys_json or "[]"),
            "weighted_question_keys": json.loads(c.weighted_question_keys_json or "[]"),
            "sort_order": c.sort_order,
        }
        for c in criteria
    ]


def _prompts_snapshot(prompts_dict: dict[int, str], criteria) -> dict[str, str]:
    """Map criterion_name → system_prompt. Names (not IDs) survive replays."""
    name_by_id = {c.id: c.name for c in criteria}
    return {name_by_id[cid]: prompts_dict[cid] for cid in prompts_dict if cid in name_by_id}


def _examples_snapshot(example_repo, project_id: int) -> list[dict]:
    """All active calibration examples in the project, flattened."""
    by_crit = example_repo.get_active_as_dict(project_id)
    snap: list[dict] = []
    for crit_id, examples in by_crit.items():
        for ex in examples:
            snap.append({
                "criterion_id": crit_id,
                "application_id": ex.application_id,
                "human_score": ex.human_score,
                "synthesized_reasoning": ex.synthesized_reasoning,
                "condensed_answers": json.loads(ex.condensed_answers_json or "[]"),
                "source": ex.source,
                "sort_order": ex.sort_order,
            })
    return snap


def _test_metrics_snapshot(metric_repo, project_id: int, iteration_id: int) -> dict:
    """Capture every metric on the test split for this iteration, plus the H-H baseline."""
    test_metrics = metric_repo.get_for_project(
        project_id, iteration_id=iteration_id, split="test",
    )
    baseline = metric_repo.get_for_project(
        project_id, iteration_id=None, split="all",
    )
    return {
        "llm_h_test": [_metric_to_dict(m) for m in test_metrics],
        "hh_baseline": [_metric_to_dict(m) for m in baseline],
    }


def _metric_to_dict(m) -> dict:
    return {
        "criterion_id": m.criterion_id,
        "metric": m.metric,
        "value": m.value,
        "ci_low": m.ci_low,
        "ci_high": m.ci_high,
        "n": m.n,
    }


# ============================================================
# Response shaping
# ============================================================


def _locked_to_summary(lp: LockedPrompt) -> dict:
    return {
        "id": lp.id,
        "project_id": lp.project_id,
        "iteration_id": lp.iteration_id,
        "name": lp.name,
        "prompt_hash": lp.prompt_hash,
        "provider": lp.provider,
        "model": lp.model,
        "locked_by": lp.locked_by,
        "locked_at": lp.locked_at,
    }


def _locked_to_detail(lp: LockedPrompt) -> dict:
    return {
        "id": lp.id,
        "project_id": lp.project_id,
        "iteration_id": lp.iteration_id,
        "name": lp.name,
        "prompt_hash": lp.prompt_hash,
        "provider": lp.provider,
        "model": lp.model,
        "rubric_snapshot": json.loads(lp.rubric_snapshot_json or "{}"),
        "prompts_snapshot": json.loads(lp.prompts_snapshot_json or "{}"),
        "examples_snapshot": json.loads(lp.examples_snapshot_json) if lp.examples_snapshot_json else None,
        "test_metrics": json.loads(lp.test_metrics_json or "{}"),
        "locked_by": lp.locked_by,
        "locked_at": lp.locked_at,
    }
