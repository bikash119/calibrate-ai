"""Iteration management — versioned per-criterion prompt sets.

Each iteration is a snapshot of "the prompts the operator wants to try right
now." Iterations never mutate after creation; new ideas → new iteration.
"""

import difflib
import json
import logging

from database import get_db_cursor
from db_models import (
    AgreementMetricRepository,
    AuditLogRepository,
    CalibrationExampleRepository,
    CriteriaRepository,
    Iteration,
    IterationPrompt,
    IterationPromptRepository,
    IterationRepository,
    ProjectRepository,
)
from prompts import build_system_prompt

logger = logging.getLogger("scoring_ai.services.iteration")


class IterationService:
    """Create, list, and diff iterations within a project."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.criteria_repo = CriteriaRepository()
        self.iteration_repo = IterationRepository()
        self.prompt_repo = IterationPromptRepository()
        self.metric_repo = AgreementMetricRepository()
        self.example_repo = CalibrationExampleRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Read paths                                                          #
    # ------------------------------------------------------------------ #

    def list_with_metrics(self, project_id: int) -> list[dict]:
        """List iterations annotated with per-criterion and overall LLM-H metrics."""
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        iterations = self.iteration_repo.get_by_project(project_id)
        if not iterations:
            return []

        criteria = self.criteria_repo.get_by_project(project_id)
        crit_name_by_id = {c.id: c.name for c in criteria}

        out: list[dict] = []
        for it in iterations:
            dev = self._iteration_metrics(project_id, it.id, "dev", crit_name_by_id)
            val = self._iteration_metrics(project_id, it.id, "validation", crit_name_by_id)
            out.append({
                "id": it.id,
                "project_id": it.project_id,
                "version": it.version,
                "note": it.note,
                "status": it.status,
                "parent_iteration_id": it.parent_iteration_id,
                "edited_criterion_ids": json.loads(it.edited_criterion_ids_json or "[]"),
                "dev_metrics": dev["per_criterion"],
                "validation_metrics": val["per_criterion"],
                "overall_dev_qwk": dev["overall_qwk"],
                "overall_validation_qwk": val["overall_qwk"],
                "created_at": it.created_at,
            })
        return out

    def get_detail(self, project_id: int, iteration_id: int) -> dict:
        it = self.iteration_repo.get_by_id(iteration_id)
        if not it or it.project_id != project_id:
            raise ValueError(f"Iteration {iteration_id} not found in project {project_id}")

        criteria = self.criteria_repo.get_by_project(project_id)
        crit_name_by_id = {c.id: c.name for c in criteria}
        prompts_dict = self.prompt_repo.get_as_dict(iteration_id)
        prompts = [
            {
                "criterion_id": cid,
                "criterion_name": crit_name_by_id.get(cid, "(unknown)"),
                "system_prompt": prompts_dict[cid],
            }
            for cid in sorted(prompts_dict.keys())
        ]
        dev = self._iteration_metrics(project_id, iteration_id, "dev", crit_name_by_id)
        val = self._iteration_metrics(project_id, iteration_id, "validation", crit_name_by_id)
        return {
            "id": it.id,
            "project_id": it.project_id,
            "version": it.version,
            "note": it.note,
            "status": it.status,
            "parent_iteration_id": it.parent_iteration_id,
            "edited_criterion_ids": json.loads(it.edited_criterion_ids_json or "[]"),
            "prompts": prompts,
            "dev_metrics": dev["per_criterion"],
            "validation_metrics": val["per_criterion"],
            "created_at": it.created_at,
        }

    # ------------------------------------------------------------------ #
    # Write paths                                                         #
    # ------------------------------------------------------------------ #

    def create(
        self,
        project_id: int,
        prompts: list[dict] | None,
        note: str | None,
        user_id: int,
        *,
        parent_iteration_id: int | None = None,
        edited_criterion_ids: list[int] | None = None,
        as_draft: bool = False,
    ) -> int:
        """Create a new iteration.

        Two creation modes:

        **Full** (legacy): `parent_iteration_id` is None and `edited_criterion_ids`
        is None. If `prompts` is empty/None, auto-generate one prompt per rubric
        criterion (with active calibration examples injected). If `prompts` is
        provided, every project criterion must have exactly one entry.

        **Sparse overlay** (shape A): `parent_iteration_id` is set and
        `edited_criterion_ids` lists the criterion ids the operator is
        revising this round. For each criterion:
          - If it's in `edited_criterion_ids` and `prompts` has an entry → use
            the operator's prompt.
          - If it's in `edited_criterion_ids` but `prompts` is empty/missing →
            auto-generate from rubric (so the prompt always exists).
          - Otherwise → copy the parent iteration's prompt verbatim.
        Untouched criteria carry their parent's prompt forward; the scoring
        service will reuse the parent's `llm_scores` when this iteration is
        scored on the same split.
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")

        criteria = self.criteria_repo.get_by_project(project_id)
        if not criteria:
            raise ValueError("Project has no rubric. Save the rubric first.")

        crit_by_id = {c.id: c for c in criteria}
        is_overlay = parent_iteration_id is not None
        edited_set = set(edited_criterion_ids or [])

        if is_overlay:
            parent = self.iteration_repo.get_by_id(parent_iteration_id)
            if not parent or parent.project_id != project_id:
                raise ValueError(
                    f"parent_iteration_id={parent_iteration_id} not found in project {project_id}"
                )
            unknown = edited_set - set(crit_by_id)
            if unknown:
                raise ValueError(
                    f"edited_criterion_ids reference unknown criteria: {sorted(unknown)}"
                )
            parent_prompts = self.prompt_repo.get_as_dict(parent.id)
            examples_by_crit = self.example_repo.get_active_as_dict(project_id)
            provided_by_crit = {
                p["criterion_id"]: p["system_prompt"] for p in (prompts or [])
            }

            prompt_rows: list[IterationPrompt] = []
            for c in criteria:
                if c.id in edited_set:
                    text = provided_by_crit.get(c.id) or build_system_prompt(
                        c, examples_by_crit.get(c.id, []),
                    )
                else:
                    # Inherit verbatim. If the parent didn't have a prompt for
                    # this criterion (would be unusual — only happens if the
                    # rubric grew between iterations), auto-generate as a fallback.
                    text = parent_prompts.get(c.id) or build_system_prompt(
                        c, examples_by_crit.get(c.id, []),
                    )
                prompt_rows.append(IterationPrompt(
                    iteration_id=0,
                    criterion_id=c.id,
                    system_prompt=text,
                ))
        elif prompts:
            provided_ids = {p["criterion_id"] for p in prompts}
            unknown = provided_ids - set(crit_by_id)
            if unknown:
                raise ValueError(f"Prompts reference unknown criterion ids: {sorted(unknown)}")
            missing = set(crit_by_id) - provided_ids
            if missing:
                raise ValueError(
                    f"Missing prompts for criteria: {sorted(missing)} "
                    "(must provide one per criterion)"
                )
            prompt_rows = [
                IterationPrompt(
                    iteration_id=0,    # set after iteration is created
                    criterion_id=p["criterion_id"],
                    system_prompt=p["system_prompt"],
                )
                for p in prompts
            ]
        else:
            # Auto-generate from rubric, injecting active calibration examples.
            examples_by_crit = self.example_repo.get_active_as_dict(project_id)
            prompt_rows = [
                IterationPrompt(
                    iteration_id=0,
                    criterion_id=c.id,
                    system_prompt=build_system_prompt(c, examples_by_crit.get(c.id, [])),
                )
                for c in criteria
            ]

        version = self.iteration_repo.next_version(project_id)
        iteration_id = self.iteration_repo.create(Iteration(
            project_id=project_id,
            version=version,
            note=note,
            status="draft" if as_draft else "active",
            parent_iteration_id=parent_iteration_id,
            edited_criterion_ids_json=json.dumps(sorted(edited_set)),
            created_by=user_id,
        ))
        for pr in prompt_rows:
            pr.iteration_id = iteration_id
        self.prompt_repo.bulk_upsert(prompt_rows)

        self.audit.log("iteration", iteration_id, "created", user_id=user_id, details={
            "project_id": project_id,
            "version": version,
            "auto_generated": not bool(prompts) and not is_overlay,
            "overlay_from": parent_iteration_id,
            "edited_criterion_ids": sorted(edited_set) if is_overlay else None,
            "as_draft": as_draft,
            "criterion_count": len(prompt_rows),
        })
        logger.info(
            "Created iteration %d (project=%d, version=%d, overlay=%s, draft=%s, user=%d)",
            iteration_id, project_id, version,
            parent_iteration_id, as_draft, user_id,
        )
        return iteration_id

    def update_status(self, iteration_id: int, new_status: str, user_id: int) -> None:
        """Move an iteration between draft / active / abandoned."""
        if new_status not in ("draft", "active", "abandoned"):
            raise ValueError(
                f"Invalid status '{new_status}'. Use 'draft', 'active', or 'abandoned'."
            )
        it = self.iteration_repo.get_by_id(iteration_id)
        if not it:
            raise ValueError(f"Iteration {iteration_id} not found")
        old = it.status
        self.iteration_repo.update_status(iteration_id, new_status)
        self.audit.log("iteration", iteration_id, "status_changed", user_id=user_id, details={
            "from": old, "to": new_status,
        })

    # ------------------------------------------------------------------ #
    # Diff between iterations                                             #
    # ------------------------------------------------------------------ #

    def diff(
        self,
        project_id: int,
        from_version: int,
        to_version: int,
    ) -> dict:
        """Per-criterion unified diff between two iteration versions."""
        # Resolve versions to iteration IDs
        all_its = self.iteration_repo.get_by_project(project_id)
        by_v = {it.version: it for it in all_its}
        if from_version not in by_v:
            raise ValueError(f"Version {from_version} not found in project {project_id}")
        if to_version not in by_v:
            raise ValueError(f"Version {to_version} not found in project {project_id}")

        from_prompts = self.prompt_repo.get_as_dict(by_v[from_version].id)
        to_prompts = self.prompt_repo.get_as_dict(by_v[to_version].id)

        criteria = self.criteria_repo.get_by_project(project_id)
        per_criterion = []
        for c in criteria:
            old = from_prompts.get(c.id, "")
            new = to_prompts.get(c.id, "")
            if old == new:
                continue   # only report criteria that changed
            per_criterion.append({
                "criterion_id": c.id,
                "criterion_name": c.name,
                "lines": _unified_diff_lines(old, new),
            })

        return {
            "project_id": project_id,
            "from_version": from_version,
            "to_version": to_version,
            "per_criterion": per_criterion,
        }

    # ------------------------------------------------------------------ #
    # Internal: pull metrics for an iteration                             #
    # ------------------------------------------------------------------ #

    def _iteration_metrics(
        self,
        project_id: int,
        iteration_id: int,
        split: str,
        crit_name_by_id: dict[int, str],
    ) -> dict:
        rows = self.metric_repo.get_for_project(
            project_id,
            iteration_id=iteration_id,
            split=split,
            metric="qwk",
        )
        per_criterion = []
        overall_qwk: float | None = None
        for m in rows:
            if m.criterion_id is None:
                overall_qwk = m.value
                continue
            per_criterion.append({
                "criterion_id": m.criterion_id,
                "criterion_name": crit_name_by_id.get(m.criterion_id, "(unknown)"),
                "qwk": m.value,
                "qwk_ci_low": m.ci_low,
                "qwk_ci_high": m.ci_high,
                "n": m.n,
            })
        return {"per_criterion": per_criterion, "overall_qwk": overall_qwk}


def _unified_diff_lines(old: str, new: str) -> list[dict]:
    """Convert difflib.unified_diff output into our DiffLineItem shape."""
    lines: list[dict] = []
    for line in difflib.unified_diff(old.splitlines(), new.splitlines(), lineterm=""):
        if line.startswith("---") or line.startswith("+++") or line.startswith("@@"):
            continue
        if line.startswith("+"):
            lines.append({"type": "add", "text": line[1:]})
        elif line.startswith("-"):
            lines.append({"type": "rm", "text": line[1:]})
        else:
            lines.append({"type": "context", "text": line[1:] if line.startswith(" ") else line})
    return lines
