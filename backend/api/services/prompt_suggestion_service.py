"""Auto-suggest a refined system prompt for one criterion.

Driven by the operator clicking "Suggest refinement" in the create-iteration
flow. Given the criterion + the current prompt + the parent iteration's
flagged disagreements (where the LLM diverged from the human median), we
ask a separate LLM to draft a tightened version. The operator reviews and
either applies, edits, or discards.

Why a separate model is the default: the suggester is exactly the LLM that
mis-scored under the current prompt — using the same model to fix its own
prompt is a soft feedback loop. Default to a stronger model for refinement
(see api/services/scoring_job_service for scoring defaults).
"""

import json
import logging
import re

from db_models import (
    AuditLogRepository,
    CriteriaRepository,
    DisagreementFlagRepository,
    IterationPromptRepository,
    IterationRepository,
    LlmScoreRepository,
    ProjectRepository,
)
from llm_client import get_llm_client

logger = logging.getLogger("scoring_ai.services.prompt_suggestion")


SYSTEM_PROMPT = """\
You are an expert prompt engineer helping calibrate LLM scoring against
human evaluators. You'll receive:
  - One criterion (name, description, scale, anchor descriptions)
  - The CURRENT system prompt the LLM uses when scoring that criterion
  - A list of disagreement cases — applications where the LLM's score
    diverged from the human median, including the LLM's reasoning

Produce a REVISED system prompt that addresses the patterns you see.
Constraints:
  - Stay grounded in the criterion's anchor descriptions. Don't invent
    new scoring axes the rubric didn't define.
  - Be concrete: name the specific evidence patterns that should shift
    a score, drawing from the disagreement examples you were given.
  - Preserve the existing prompt's structure (rubric/anchors block,
    output format) — your revision should slot into that template, not
    replace it wholesale.
  - Don't pad with hedges or generic advice. Every line should change
    behavior on the cases shown.

Output ONLY a JSON object — no markdown fences, no preamble:
{"suggested_prompt": "<full revised system prompt>",
 "reasoning": "<2-3 sentences on what changed and why>"}
"""


def suggest_refined_prompt(
    project_id: int,
    iteration_id: int,
    criterion_id: int,
    user_id: int,
    *,
    current_prompt: str | None = None,
    lesson_cap: int = 5,
) -> dict:
    """Return a suggested refined system prompt for one criterion.

    `iteration_id` is the parent iteration whose disagreements we draw on.
    `current_prompt` defaults to the parent iteration's stored prompt for
    this criterion. Returns `{"suggested_prompt", "reasoning"}`.
    """
    project_repo = ProjectRepository()
    if not project_repo.get_by_id(project_id):
        raise ValueError(f"Project {project_id} not found")

    iteration = IterationRepository().get_by_id(iteration_id)
    if not iteration or iteration.project_id != project_id:
        raise ValueError(f"Iteration {iteration_id} not found in project {project_id}")

    criterion = CriteriaRepository().get_by_id(criterion_id)
    if not criterion or criterion.project_id != project_id:
        raise ValueError(f"Criterion {criterion_id} not found in project {project_id}")

    if current_prompt is None or not current_prompt.strip():
        prompts = IterationPromptRepository().get_as_dict(iteration_id)
        current_prompt = prompts.get(criterion_id, "")
        if not current_prompt:
            raise ValueError(
                f"No system prompt stored for criterion {criterion_id} in "
                f"iteration {iteration_id} — nothing to refine."
            )

    # Pull the disagreements: prefer operator-flagged "human_correct" rows
    # (high signal); fall back to any disagreement on the parent iteration.
    flagged = _find_flagged_disagreements(
        project_id, iteration_id, criterion_id, lesson_cap,
    )
    if not flagged:
        raise ValueError(
            f"No disagreement signal available for criterion {criterion_id} "
            f"on iteration {iteration_id}. Score the parent iteration on dev "
            f"and flag a few rows before requesting a suggestion."
        )

    user_prompt = _render_user_prompt(criterion, current_prompt, flagged)
    client = get_llm_client()
    raw = client.generate(SYSTEM_PROMPT, user_prompt)
    parsed = _parse_suggestion_response(raw)

    AuditLogRepository().log(
        "iteration", iteration_id, "prompt_suggestion_requested",
        user_id=user_id,
        details={
            "criterion_id": criterion_id,
            "lesson_count": len(flagged),
        },
    )
    logger.info(
        "Suggested refinement for criterion %d (iteration=%d, lessons=%d)",
        criterion_id, iteration_id, len(flagged),
    )
    return parsed


# ------------------------------------------------------------------ #


def _find_flagged_disagreements(
    project_id: int,
    iteration_id: int,
    criterion_id: int,
    cap: int,
) -> list[dict]:
    """Return up to `cap` disagreement records for one (iteration, criterion).

    Each record has: application_external_id, llm_score, human_median, llm_reasoning.
    Operator-flagged 'human_correct' rows are preferred; we fall back to any
    LLM score that diverged from the human median (delta != 0)."""
    flag_repo = DisagreementFlagRepository()
    score_repo = LlmScoreRepository()
    project_flags = flag_repo.get_for_project(project_id)
    flags_by_app: dict[int, str] = {
        f.application_id: f.flag for f in project_flags
        if f.criterion_id == criterion_id
    }

    # Pull LLM scores for this iteration's criterion, then enrich with
    # human median when available. We use raw repos rather than the
    # statistics service to avoid an import cycle for a one-shot helper.
    from db_models import (
        ApplicationRepository,
        HumanScoreRepository,
        ScoringJobRepository,
    )
    app_repo = ApplicationRepository()
    human_repo = HumanScoreRepository()
    job_repo = ScoringJobRepository()

    job = job_repo.get_latest_completed(iteration_id, "dev") or \
          job_repo.get_latest_completed(iteration_id, "validation")
    if job is None:
        return []
    llm_rows = [s for s in score_repo.get_for_job(job.id) if s.criterion_id == criterion_id]

    # human medians per app for this criterion
    human_by_app: dict[int, list[int]] = {}
    for hs in human_repo.get_for_project(project_id):
        if hs.criterion_id == criterion_id:
            human_by_app.setdefault(hs.application_id, []).append(hs.score)

    candidates: list[tuple[int, dict]] = []   # (priority, record)
    for s in llm_rows:
        humans = human_by_app.get(s.application_id, [])
        if not humans:
            continue
        sorted_h = sorted(humans)
        n = len(sorted_h)
        median = sorted_h[n // 2] if n % 2 == 1 else (sorted_h[n // 2 - 1] + sorted_h[n // 2]) / 2.0
        if median == s.score:
            continue
        app = app_repo.get_by_id(s.application_id)
        if app is None:
            continue
        flag = flags_by_app.get(s.application_id)
        # priority: 0 = operator says human is right (best signal),
        #           1 = ambiguous, 2 = unflagged divergence,
        #           3 = operator says LLM is right (we'd be making the prompt
        #               worse if we taught from these — exclude).
        priority = (
            0 if flag == "human_correct"
            else 1 if flag == "ambiguous"
            else 2 if flag is None
            else 99
        )
        if priority >= 99:
            continue
        candidates.append((priority, {
            "application_external_id": app.external_id,
            "llm_score": s.score,
            "human_median": float(median),
            "llm_reasoning": (s.reasoning or "")[:600],
        }))

    candidates.sort(key=lambda t: t[0])
    return [rec for _, rec in candidates[:cap]]


def _render_user_prompt(criterion, current_prompt: str, lessons: list[dict]) -> str:
    anchors = json.loads(criterion.anchor_descriptions_json or "{}")
    anchor_block = "\n".join(
        f"  {k}: {v}" for k, v in sorted(anchors.items(), key=lambda kv: kv[0], reverse=True)
    )
    lesson_block = "\n\n".join(
        f"App {l['application_external_id']}\n"
        f"  LLM said: {l['llm_score']}\n"
        f"  Human median: {l['human_median']}\n"
        f"  LLM reasoning: {l['llm_reasoning']}"
        for l in lessons
    )
    return f"""\
# Criterion
Name: {criterion.name}
Description: {criterion.description}
Scale: {criterion.scale_min} to {criterion.scale_max}
Anchors:
{anchor_block}

# Current system prompt
```
{current_prompt}
```

# Disagreements (LLM diverged from human median)
{lesson_block}

# Task
Produce the revised system prompt + a 2-3 sentence rationale, JSON-only.
"""


_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```", re.DOTALL)


def _parse_suggestion_response(raw: str) -> dict:
    """The system prompt asks for raw JSON; tolerate fence-wrapping."""
    text = raw.strip()
    fence = _FENCE_RE.search(text)
    if fence:
        text = fence.group(1)
    elif "{" in text and "}" in text:
        first = text.find("{")
        last = text.rfind("}")
        text = text[first : last + 1]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Suggestion model returned malformed JSON: {e}. Raw response "
            f"begins: {raw[:200]}"
        )
    if not isinstance(parsed, dict):
        raise ValueError("Suggestion model response was not a JSON object")
    if "suggested_prompt" not in parsed or not str(parsed["suggested_prompt"]).strip():
        raise ValueError("Suggestion model response missing 'suggested_prompt'")
    return {
        "suggested_prompt": str(parsed["suggested_prompt"]),
        "reasoning": str(parsed.get("reasoning", "")),
    }
