"""Calibration examples — select diverse human-scored apps and synthesize reasoning.

Selection priority (dev-split only — never leak test-set apps into prompts):
  1. Operator-flagged 'human_correct' disagreements (gold standard)
  2. Evaluator consensus (all evaluators gave the same score)
  3. Median fallback (uses median of multiple-evaluator apps)

Diversity: one example per score level first, then fill from highest-priority
remainder.

Reasoning is synthesized via the LLM client — a 2-3 sentence justification
that explains WHY the known-correct human score is correct, citing evidence.
"""

import json
import logging
import statistics as stdlib_stats

from db_models import (
    ApplicationRepository,
    AuditLogRepository,
    CalibrationExample,
    CalibrationExampleRepository,
    CriteriaRepository,
    DisagreementFlagRepository,
    HumanScoreRepository,
    ProjectRepository,
    QuestionRepository,
    SplitRepository,
)
from llm_client import get_llm_client

logger = logging.getLogger("scoring_ai.services.calibration")


REASONING_SYSTEM_PROMPT = """\
You are an expert evaluator writing a short justification for a known-correct \
score on a grant/program application.

You receive:
1. A scoring criterion with rubric anchor descriptions
2. The relevant application answers
3. The CORRECT score (already assigned by expert human evaluators)

Your task: write 2-3 sentences explaining WHY this score is correct, based on \
the evidence in the answers and the rubric anchor for the given score level.

Rules:
- Cite specific evidence from the answers (use the question key, e.g. 'q1').
- Connect the evidence to the rubric anchor for this exact score.
- Treat the score as ground truth — never suggest it could be different.
- Be concise and factual; this text will be used as a worked example.
- Write in English.

Respond with ONLY the reasoning text — no JSON, no preamble, no quotes.\
"""

ANSWER_TRUNCATE_CHARS = 250
MIN_EVALUATORS_FOR_CONSENSUS = 2


class CalibrationService:
    """Generate, list, and toggle calibration examples per (project, criterion)."""

    def __init__(self):
        self.project_repo = ProjectRepository()
        self.criteria_repo = CriteriaRepository()
        self.app_repo = ApplicationRepository()
        self.question_repo = QuestionRepository()
        self.human_repo = HumanScoreRepository()
        self.flag_repo = DisagreementFlagRepository()
        self.split_repo = SplitRepository()
        self.example_repo = CalibrationExampleRepository()
        self.audit = AuditLogRepository()

    # ------------------------------------------------------------------ #
    # Read paths                                                         #
    # ------------------------------------------------------------------ #

    def list_for_criterion(
        self, project_id: int, criterion_id: int, active_only: bool = False
    ) -> list[dict]:
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        crit = self.criteria_repo.get_by_id(criterion_id)
        if not crit or crit.project_id != project_id:
            raise ValueError(f"Criterion {criterion_id} not found in project {project_id}")
        examples = self.example_repo.get_for_criterion(project_id, criterion_id, active_only=active_only)
        apps_by_id = {a.id: a.external_id for a in self.app_repo.get_by_project(project_id)}
        return [_example_to_dict(ex, apps_by_id) for ex in examples]

    # ------------------------------------------------------------------ #
    # Generate                                                           #
    # ------------------------------------------------------------------ #

    def generate(
        self,
        project_id: int,
        criterion_id: int,
        max_examples: int,
        user_id: int,
    ) -> list[dict]:
        """Select candidates, synthesize reasoning, store examples atomically."""
        project = self.project_repo.get_by_id(project_id)
        if not project:
            raise ValueError(f"Project {project_id} not found")
        crit = self.criteria_repo.get_by_id(criterion_id)
        if not crit or crit.project_id != project_id:
            raise ValueError(f"Criterion {criterion_id} not found in project {project_id}")
        if max_examples < 1:
            raise ValueError("max_examples must be >= 1")

        dev_app_ids = set(self.split_repo.get_application_ids(project_id, "dev"))
        if not dev_app_ids:
            raise ValueError("Dev split is empty — generate splits first")

        candidates = self._collect_candidates(project_id, criterion_id, dev_app_ids)
        if not candidates:
            raise ValueError(
                "No candidate applications found. Need either operator-flagged disagreements, "
                "evaluator consensus, or apps with ≥2 evaluators."
            )

        chosen = _select_diverse(candidates, max_examples)
        logger.info(
            "Selected %d/%d calibration candidates for project %d criterion %d (sources: %s)",
            len(chosen), max_examples, project_id, criterion_id,
            [c["source"] for c in chosen],
        )

        # Synthesize reasoning for each via the LLM
        anchors = json.loads(crit.anchor_descriptions_json or "{}")
        client = get_llm_client()
        rows: list[CalibrationExample] = []
        for i, c in enumerate(chosen):
            reasoning = _synthesize_reasoning(client, crit, anchors, c)
            rows.append(CalibrationExample(
                project_id=project_id,
                criterion_id=criterion_id,
                application_id=c["application_id"],
                human_score=c["human_score"],
                synthesized_reasoning=reasoning,
                condensed_answers_json=json.dumps(c["condensed_answers"], ensure_ascii=False),
                source=c["source"],
                is_active=1,
                sort_order=i,
            ))

        self.example_repo.replace_for_criterion(project_id, criterion_id, rows)
        self.audit.log("project", project_id, "calibration_examples_generated",
                       user_id=user_id, details={
                           "criterion_id": criterion_id,
                           "count": len(rows),
                           "sources": [c["source"] for c in chosen],
                       })
        return self.list_for_criterion(project_id, criterion_id)

    def set_active(self, example_id: int, is_active: bool, user_id: int) -> None:
        self.example_repo.set_active(example_id, is_active)
        self.audit.log("calibration_example", example_id, "active_set",
                       user_id=user_id, details={"is_active": is_active})

    def promote_single(
        self,
        project_id: int,
        criterion_id: int,
        application_id: int,
        human_score: int,
        source: str,
        user_id: int,
    ) -> dict:
        """Insert a single calibration example for one (criterion, application).

        Used by the SelectExamplesModal: the operator picks a specific
        disagreement (LLM ≠ human) or agreement (LLM = human) and promotes
        it. The reasoning is auto-LLM-generated via _synthesize_reasoning so
        the operator doesn't have to type it.

        Returns the new example in the same shape `list_for_criterion` uses.
        """
        if not self.project_repo.get_by_id(project_id):
            raise ValueError(f"Project {project_id} not found")
        crit = self.criteria_repo.get_by_id(criterion_id)
        if not crit or crit.project_id != project_id:
            raise ValueError(
                f"Criterion {criterion_id} not found in project {project_id}"
            )
        app = self.app_repo.get_by_id(application_id)
        if not app or app.project_id != project_id:
            raise ValueError(
                f"Application {application_id} not found in project {project_id}"
            )
        if not (crit.scale_min <= human_score <= crit.scale_max):
            raise ValueError(
                f"human_score {human_score} is outside the criterion's "
                f"{crit.scale_min}..{crit.scale_max} scale"
            )
        if source not in ("operator_flagged", "evaluator_consensus", "auto", "manual"):
            raise ValueError(
                f"Invalid source '{source}'. Use one of: operator_flagged, "
                f"evaluator_consensus, auto, manual."
            )

        # Build the candidate dict the existing reasoning helper expects.
        questions_by_key = {
            q.key: q for q in self.question_repo.get_by_project(project_id)
        }
        feeding_keys = json.loads(crit.feeding_question_keys_json or "[]")
        weighted_keys = set(json.loads(crit.weighted_question_keys_json or "[]"))
        candidate = {
            "application_id": application_id,
            "external_id": app.external_id,
            "human_score": human_score,
            "condensed_answers": _condense_answers(
                app, feeding_keys, weighted_keys, questions_by_key,
            ),
            "source": source,
        }

        anchors = json.loads(crit.anchor_descriptions_json or "{}")
        client = get_llm_client()
        reasoning = _synthesize_reasoning(client, crit, anchors, candidate)

        # Append-after-existing for sort order (keeps explicit promotions at
        # the end of the list — operators can re-sort later if needed).
        existing = self.example_repo.get_for_criterion(
            project_id, criterion_id, active_only=False,
        )
        next_sort = max((ex.sort_order for ex in existing), default=-1) + 1

        new_id = self.example_repo.create(CalibrationExample(
            project_id=project_id,
            criterion_id=criterion_id,
            application_id=application_id,
            human_score=human_score,
            synthesized_reasoning=reasoning,
            condensed_answers_json=json.dumps(
                candidate["condensed_answers"], ensure_ascii=False,
            ),
            source=source,
            is_active=1,
            sort_order=next_sort,
        ))
        self.audit.log("calibration_example", new_id, "promoted",
                       user_id=user_id, details={
                           "project_id": project_id,
                           "criterion_id": criterion_id,
                           "application_id": application_id,
                           "human_score": human_score,
                           "source": source,
                       })
        # Reload to get the row with timestamp + id populated.
        rows = self.example_repo.get_for_criterion(
            project_id, criterion_id, active_only=False,
        )
        new_row = next((r for r in rows if r.id == new_id), None)
        if new_row is None:
            raise RuntimeError(f"Just-inserted example {new_id} not readable")
        return _example_to_dict(new_row, {app.id: app.external_id})

    # ------------------------------------------------------------------ #
    # Internals: candidate collection                                    #
    # ------------------------------------------------------------------ #

    def _collect_candidates(
        self, project_id: int, criterion_id: int, dev_app_ids: set[int]
    ) -> list[dict]:
        """Build the candidate pool, in priority order with deduplication."""
        # Group all human scores once
        human_groups: dict[int, list[int]] = {}
        for hs in self.human_repo.get_for_project(project_id):
            if hs.criterion_id == criterion_id and hs.application_id in dev_app_ids:
                human_groups.setdefault(hs.application_id, []).append(hs.score)

        apps_by_id = {a.id: a for a in self.app_repo.get_by_project(project_id)}
        questions_by_key = {q.key: q for q in self.question_repo.get_by_project(project_id)}
        crit = self.criteria_repo.get_by_id(criterion_id)
        feeding_keys = json.loads(crit.feeding_question_keys_json or "[]")
        weighted_keys = set(json.loads(crit.weighted_question_keys_json or "[]"))

        candidates: list[dict] = []
        seen_app_ids: set[int] = set()

        # Source 1: operator-flagged 'human_correct' on this criterion
        flags = self.flag_repo.get_for_project(project_id)
        for f in flags:
            if (f.criterion_id != criterion_id or f.flag != "human_correct"
                    or f.application_id not in dev_app_ids):
                continue
            scores = human_groups.get(f.application_id, [])
            if not scores:
                continue
            human_score = int(round(stdlib_stats.median(scores)))
            app = apps_by_id.get(f.application_id)
            if not app:
                continue
            candidates.append({
                "application_id": f.application_id,
                "external_id": app.external_id,
                "human_score": human_score,
                "condensed_answers": _condense_answers(app, feeding_keys, weighted_keys, questions_by_key),
                "source": "operator_flagged",
            })
            seen_app_ids.add(f.application_id)

        # Source 2: evaluator consensus (all same score, n >= 2)
        for app_id, scores in human_groups.items():
            if app_id in seen_app_ids:
                continue
            if len(scores) >= MIN_EVALUATORS_FOR_CONSENSUS and len(set(scores)) == 1:
                app = apps_by_id.get(app_id)
                if not app:
                    continue
                candidates.append({
                    "application_id": app_id,
                    "external_id": app.external_id,
                    "human_score": scores[0],
                    "condensed_answers": _condense_answers(app, feeding_keys, weighted_keys, questions_by_key),
                    "source": "evaluator_consensus",
                })
                seen_app_ids.add(app_id)

        # Source 3: median fallback (n >= 2, but evaluators disagree)
        for app_id, scores in human_groups.items():
            if app_id in seen_app_ids:
                continue
            if len(scores) < MIN_EVALUATORS_FOR_CONSENSUS:
                continue
            app = apps_by_id.get(app_id)
            if not app:
                continue
            candidates.append({
                "application_id": app_id,
                "external_id": app.external_id,
                "human_score": int(round(stdlib_stats.median(scores))),
                "condensed_answers": _condense_answers(app, feeding_keys, weighted_keys, questions_by_key),
                "source": "auto",
            })
            seen_app_ids.add(app_id)

        return candidates


# ============================================================
# Internal helpers
# ============================================================


def _select_diverse(candidates: list[dict], max_examples: int) -> list[dict]:
    """One example per score level first, then fill from highest-priority remainder.

    Order is preserved within each score-level bucket, so operator_flagged
    candidates come before consensus, which come before auto.
    """
    if not candidates:
        return []
    by_score: dict[int, list[dict]] = {}
    for c in candidates:
        by_score.setdefault(c["human_score"], []).append(c)

    selected: list[dict] = []
    selected_apps: set[int] = set()
    for score in sorted(by_score):
        if len(selected) >= max_examples:
            break
        first = by_score[score][0]
        selected.append(first)
        selected_apps.add(first["application_id"])

    if len(selected) < max_examples:
        for c in candidates:
            if len(selected) >= max_examples:
                break
            if c["application_id"] not in selected_apps:
                selected.append(c)
                selected_apps.add(c["application_id"])

    return selected


def _condense_answers(app, feeding_keys: list[str], weighted_keys: set[str], questions_by_key: dict) -> list[dict]:
    """Build the condensed-answers payload that gets stored + injected into prompts."""
    answers = json.loads(app.answers_json or "{}")
    condensed: list[dict] = []
    for key in feeding_keys:
        text = (answers.get(key) or "").strip()
        if not text:
            text = "(not provided)"
        elif len(text) > ANSWER_TRUNCATE_CHARS:
            text = text[:ANSWER_TRUNCATE_CHARS - 1] + "…"
        condensed.append({
            "question_key": key,
            "answer_text": text,
            "is_weighted": key in weighted_keys,
        })
    return condensed


def _synthesize_reasoning(client, crit, anchors: dict, candidate: dict) -> str:
    """Ask the LLM to justify the known-correct score."""
    anchor_lines = "\n".join(
        f"- {k}: {anchors[k]}"
        for k in sorted(anchors.keys(), key=_anchor_sort_key)
    )
    answer_lines: list[str] = []
    for ans in candidate["condensed_answers"]:
        mark = " [IMPORTANT]" if ans.get("is_weighted") else ""
        answer_lines.append(f"**{ans['question_key']}{mark}:** {ans['answer_text']}")

    user_prompt = (
        f"# Criterion: {crit.name}\n"
        f"{crit.description.strip()}\n\n"
        f"Scale: {crit.scale_min} to {crit.scale_max}\n"
        f"{anchor_lines}\n\n"
        f"# Application answers\n"
        f"{chr(10).join(answer_lines)}\n\n"
        f"# Correct score: {candidate['human_score']}\n\n"
        f"Write 2-3 sentences justifying why this is the correct score."
    )

    raw = client.generate(REASONING_SYSTEM_PROMPT, user_prompt)
    text = (raw or "").strip()
    # Strip stray surrounding quotes if the LLM ignored "no quotes" instruction
    if text.startswith('"') and text.endswith('"'):
        text = text[1:-1]
    return text


def _anchor_sort_key(k: str):
    try:
        return (0, int(k))
    except (ValueError, TypeError):
        return (1, k)


def _example_to_dict(ex: CalibrationExample, apps_by_id: dict[int, str]) -> dict:
    return {
        "id": ex.id,
        "project_id": ex.project_id,
        "criterion_id": ex.criterion_id,
        "application_id": ex.application_id,
        "application_external_id": apps_by_id.get(ex.application_id, "(unknown)"),
        "human_score": ex.human_score,
        "synthesized_reasoning": ex.synthesized_reasoning,
        "condensed_answers": json.loads(ex.condensed_answers_json or "[]"),
        "source": ex.source,
        "is_active": bool(ex.is_active),
        "sort_order": ex.sort_order,
        "created_at": ex.created_at,
    }
