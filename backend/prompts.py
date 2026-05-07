"""Prompt builders for per-criterion scoring.

The system prompt is rendered once per (criterion, calibration-examples) and
stored in `iteration_prompts.system_prompt`. The user prompt is rendered fresh
at every LLM call from the application's answers.

These functions know nothing about the database — callers pass dataclasses.
"""

import json
from typing import Iterable

from db_models import (
    Application,
    CalibrationExample,
    Criterion,
    Question,
)


# ============================================================
# System prompt — stored once per criterion in iteration_prompts
# ============================================================


SYSTEM_TEMPLATE = """\
You are an expert evaluator scoring an application against a single criterion.

# Criterion: {name}
{description}

# Scoring scale
Assign an integer score from {scale_min} to {scale_max}.
{anchor_block}

{guidance_block}\
# Output format
Return ONLY a valid JSON object — no markdown, no preamble:
{{"score": <integer>, "reasoning": "<2-3 sentences citing specific evidence>"}}

# Rules
- Score on substance only. Ignore writing style, length, polish, and demographics.
- Cite specific evidence from the answers in your reasoning.
- If the application contains no information relevant to this criterion, assign {scale_min} and say so.
- Reason in English regardless of the application's original language.\
"""


def build_system_prompt(
    criterion: Criterion,
    calibration_examples: Iterable[CalibrationExample] = (),
) -> str:
    """Render the system prompt for one criterion.

    `calibration_examples` are optional few-shot examples; when provided, they're
    appended verbatim into a "# Calibration examples" section.
    """
    anchors = json.loads(criterion.anchor_descriptions_json or "{}")
    feeding_keys = json.loads(criterion.feeding_question_keys_json or "[]")
    weighted_keys = json.loads(criterion.weighted_question_keys_json or "[]")

    anchor_lines = "\n".join(
        f"- {k}: {anchors[k]}"
        for k in sorted(anchors.keys(), key=_anchor_sort_key)
    )

    guidance_parts: list[str] = []
    if feeding_keys:
        guidance_parts.append(f"Feeding questions: {', '.join(feeding_keys)}.")
    if weighted_keys:
        guidance_parts.append(f"High-weight questions: {', '.join(weighted_keys)}.")
    guidance_block = ""
    if guidance_parts:
        guidance_block = "# Question weighting\n" + "\n".join(guidance_parts) + "\n\n"

    prompt = SYSTEM_TEMPLATE.format(
        name=criterion.name,
        description=criterion.description.strip(),
        scale_min=criterion.scale_min,
        scale_max=criterion.scale_max,
        anchor_block=anchor_lines,
        guidance_block=guidance_block,
    )

    examples = list(calibration_examples)
    if examples:
        prompt += "\n\n" + _render_examples_section(examples)

    return prompt


# ============================================================
# User prompt — built fresh per LLM call
# ============================================================


def build_user_prompt(
    criterion: Criterion,
    application: Application,
    questions_by_key: dict[str, Question],
) -> str:
    """Render the user prompt with the application's relevant answers.

    Only `feeding_question_keys` are included — irrelevant questions are dropped
    to keep tokens focused. Weighted questions are tagged `[IMPORTANT]`.
    """
    feeding_keys = json.loads(criterion.feeding_question_keys_json or "[]")
    weighted_keys = set(json.loads(criterion.weighted_question_keys_json or "[]"))
    answers = json.loads(application.answers_json or "{}")

    if not feeding_keys:
        # Fall back to all answers if the rubric didn't specify (unusual but legal).
        feeding_keys = sorted(answers.keys())

    sections = [f"# Application: {application.external_id}", "", "# Answers"]
    for key in feeding_keys:
        question = questions_by_key.get(key)
        text = question.text if question else f"(unknown question: {key})"
        ans = answers.get(key)
        if ans is None or not str(ans).strip():
            ans = "[NOT PROVIDED]"
        weight_marker = " [IMPORTANT]" if key in weighted_keys else ""
        sections.append(f"## {key}{weight_marker}: {text}")
        sections.append(str(ans))
        sections.append("")

    sections.append(f"Score this application on '{criterion.name}' and respond with JSON only.")
    return "\n".join(sections)


# ============================================================
# Internal helpers
# ============================================================


def _anchor_sort_key(k: str):
    """Sort anchors numerically when possible, alphabetically otherwise."""
    try:
        return (0, int(k))
    except (ValueError, TypeError):
        return (1, k)


def _render_examples_section(examples: list[CalibrationExample]) -> str:
    lines = [
        "# Calibration examples",
        "Use these worked examples to anchor your scoring.",
        "",
    ]
    for i, ex in enumerate(examples, 1):
        condensed = json.loads(ex.condensed_answers_json or "[]")
        lines.append(f"## Example {i} — Score: {ex.human_score}")
        for ans in condensed:
            mark = " [IMPORTANT]" if ans.get("is_weighted") else ""
            lines.append(f"**{ans.get('question_key', '')}{mark}:** {ans.get('answer_text', '')}")
        lines.append(f"Score: {ex.human_score}")
        lines.append(f"Reasoning: {ex.synthesized_reasoning}")
        lines.append("")
    return "\n".join(lines)
