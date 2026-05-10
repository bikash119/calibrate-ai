"""Extract structured criteria from a free-form rubric document.

Operators rarely have rubrics in our exact JSON shape — they have a Word doc,
a PDF, or a paragraph in an email. This service turns that text into a draft
list of criteria, which the operator then reviews and edits before saving.

The LLM is the heavy lifter; we just frame the prompt and validate the result.
The structured form is the source of truth — the raw text is logged for
audit but never used for scoring.
"""

import io
import json
import logging
import re

from db_models import Question
from llm_client import get_llm_client

logger = logging.getLogger("scoring_ai.services.rubric_extraction")


# OSS limits.
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_TEXT_CHARS = 200_000


class RubricExtractionError(ValueError):
    """User-facing extraction failure. Routes turn this into HTTP 400."""


# ============================================================
# Prompt
# ============================================================


SYSTEM_PROMPT = """\
You are an expert at parsing scoring rubrics for grant/program/admissions
evaluation. The operator will paste rubric text. Extract structured
criteria and return JSON.

Rules:
- Use snake_case for criterion names ("team_capability" not "Team Capability")
- Each criterion needs: name, description, scale_min, scale_max,
  anchor_descriptions (a JSON object keyed by integer-as-string)
- Default scale is 1–3 unless the rubric specifies otherwise
- Anchor descriptions must cover EVERY integer in [scale_min, scale_max]
- Never invent content. Use the rubric's wording verbatim where possible.

description vs anchor_descriptions (CRITICAL — common failure mode):
The two fields capture DIFFERENT parts of the rubric. Do NOT confuse them.

- `description` = the criterion's QUESTION or definition. The thing the
  evaluator is being asked to assess. Often labelled "Question:", "Prompt:",
  or appears as a one-liner under the criterion's title.
  Example: "U kojoj mjeri je tim sposoban iznijeti poduzetnički pothvat?"
  Example: "How well does the proposal address the identified problem?"

- `anchor_descriptions` = the per-criterion GUIDANCE telling the evaluator
  what each score level looks like. Often labelled "Guidance for evaluators:",
  "Scoring guidance:", "Anchors:", or simply listed as N paragraphs under
  the criterion's question.

Mapping the guidance paragraphs to integer keys:
- If guidance paragraphs are written from BEST to WORST (the most common
  pattern — "meets criteria" first, "doesn't meet" last), the FIRST paragraph
  maps to scale_max (e.g. "3"), the LAST to scale_min (e.g. "1").
- If they are explicitly labelled ("Score 3:", "1 point:"), use the labels.
- Use the FULL guidance paragraph as the anchor text, verbatim.

Global rubric preambles are NOT per-criterion anchors:
A rubric may open with a generic legend like "3 points = meets criteria,
2 points = partially meets, 1 point = doesn't meet". This is meta-context
for the evaluator, NOT the per-criterion anchor descriptions. When per-criterion
guidance paragraphs exist (under "Guidance for evaluators:" or similar), use
THOSE as anchor_descriptions. Ignore the global legend — never use it as
anchor text when criterion-specific guidance exists.

Worked example:

  Input:
    Scoring logic
    3 points = meets criteria
    2 points = has potential and partially meets criteria
    1 point = it is a zero basically. Answer is not provided.

    **Team**
    Question : U kojoj mjeri je tim sposoban iznijeti poduzetnički pothvat?
    Guidance for evaluators :
    Tim ima znanja i iskustva za potrebe poduzetničkog pothvata te je izvjesno da može kvalitetno provesti poduzetnički pothvat.

    Tim nema sva potrebna znanja i iskustva za potrebe poduzetničkog pothvata.

    S obzirom na sastav tima, postoji rizik o uspješnoj provedbi poduzetničkog pothvata.

    Evaluators use the answers in columns 8, 9, 10. 9 is the most important.

  Correct extraction:
    {
      "name": "team",
      "description": "U kojoj mjeri je tim sposoban iznijeti poduzetnički pothvat?",
      "scale_min": 1, "scale_max": 3,
      "anchor_descriptions": {
        "3": "Tim ima znanja i iskustva za potrebe poduzetničkog pothvata te je izvjesno da može kvalitetno provesti poduzetnički pothvat.",
        "2": "Tim nema sva potrebna znanja i iskustva za potrebe poduzetničkog pothvata.",
        "1": "S obzirom na sastav tima, postoji rizik o uspješnoj provedbi poduzetničkog pothvata."
      },
      "feeding_question_keys": ["8", "9", "10"],
      "weighted_question_keys": ["9"]
    }

  WRONG (do NOT do this):
    - Putting the score-3 guidance paragraph in `description`.
    - Using the global "3 points = meets criteria" legend as anchor text.
    - Using only the first sentence of a guidance paragraph as the anchor.

Feeding & weighted question extraction (IMPORTANT):
Rubrics often state which application questions feed each criterion, and which
of those carry more weight. Extract these aggressively — operators should not
have to re-tick checkboxes for information already in the rubric.

- feeding_question_keys: every question the criterion is scored from. Look
  for phrases like:
    "Evaluators use the answers in columns 8, 9, 10, 11, 12, 25, 26, 31"
    "judged based on Q1 and Q3"
    "see questions 4–7"
    "uses applicant's response to: …"
  Return each ref as a STRING, preserving the original token: "8" stays "8",
  "Q3" stays "Q3", a quoted snippet stays as the snippet. Do not invent keys.

- weighted_question_keys: the subset that the rubric calls out as primary.
  Look for phrases like:
    "9 is the most important question"
    "10 and 12 are the most important"
    "24 carries more weight"
    "primary signal: Q4"
  Every entry here must also appear in feeding_question_keys.

- If the rubric explicitly says "all questions have equal weight," return
  weighted_question_keys: []. If it doesn't mention weight at all, also [].
- If the rubric says nothing about feeding columns, return feeding_question_keys: [].

Respond ONLY with valid JSON in this exact shape:
{
  "criteria": [
    {
      "name": "snake_case_name",
      "description": "what this criterion evaluates",
      "scale_min": 1,
      "scale_max": 5,
      "anchor_descriptions": {"1": "...", "2": "...", "3": "...", "4": "...", "5": "..."},
      "feeding_question_keys": [],
      "weighted_question_keys": []
    }
  ]
}\
"""


# ============================================================
# Service
# ============================================================


class RubricExtractionService:
    def extract_from_text(
        self, text: str, questions: list[Question] | None = None,
    ) -> list[dict]:
        """Send free-form rubric text to the LLM, return validated criteria.

        If `questions` is provided, the LLM-returned refs are bound to real
        question keys and unbound refs are surfaced as `unbound_*_refs`."""
        if not text or not text.strip():
            raise RubricExtractionError("Empty rubric text")
        if len(text) > MAX_TEXT_CHARS:
            raise RubricExtractionError(
                f"Rubric text is {len(text)} chars; max is {MAX_TEXT_CHARS}"
            )

        client = get_llm_client()
        raw = client.generate(SYSTEM_PROMPT, text.strip())
        criteria = self._parse_response(raw)
        return _bind_refs(criteria, questions or [])

    def extract_from_file(
        self, file_bytes: bytes, filename: str,
        questions: list[Question] | None = None,
    ) -> list[dict]:
        """Read a document file (txt/md/docx), pull text, run extraction."""
        if len(file_bytes) > MAX_FILE_BYTES:
            raise RubricExtractionError(
                f"File too large ({len(file_bytes)} bytes); max is {MAX_FILE_BYTES}"
            )
        text = _extract_text_from_file(file_bytes, filename)
        return self.extract_from_text(text, questions=questions)

    # ------------------------------------------------------------------ #

    def _parse_response(self, raw: str) -> list[dict]:
        """Validate the LLM's JSON. Tolerant of wrapping prose / fences."""
        # Try to find JSON in the response — strip code fences, surrounding text
        cleaned = _strip_json_fence(raw)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError as e:
            logger.warning("LLM rubric extraction returned invalid JSON: %s", raw[:500])
            raise RubricExtractionError(
                f"LLM returned malformed JSON: {e}. Try simplifying the rubric or use Manual entry."
            )

        if not isinstance(parsed, dict) or "criteria" not in parsed:
            raise RubricExtractionError(
                "LLM response missing top-level 'criteria' key"
            )

        criteria_in = parsed.get("criteria") or []
        if not isinstance(criteria_in, list) or not criteria_in:
            raise RubricExtractionError(
                "No criteria extracted — try pasting more context or use Manual entry"
            )

        criteria_out: list[dict] = []
        for i, c in enumerate(criteria_in):
            if not isinstance(c, dict):
                raise RubricExtractionError(f"Criterion {i} is not a JSON object")
            try:
                criteria_out.append(_validate_criterion(c, i))
            except RubricExtractionError:
                raise
        return criteria_out


# ============================================================
# Validation + helpers
# ============================================================


def _validate_criterion(c: dict, idx: int) -> dict:
    name = (c.get("name") or "").strip()
    if not name:
        raise RubricExtractionError(f"Criterion {idx} is missing a name")
    description = (c.get("description") or "").strip()
    if not description:
        raise RubricExtractionError(
            f"Criterion '{name}' is missing a description"
        )

    try:
        scale_min = int(c.get("scale_min", 1))
        scale_max = int(c.get("scale_max", 3))
    except (TypeError, ValueError):
        raise RubricExtractionError(
            f"Criterion '{name}' has non-integer scale bounds"
        )
    if scale_max <= scale_min:
        raise RubricExtractionError(
            f"Criterion '{name}' has scale_max ({scale_max}) <= scale_min ({scale_min})"
        )

    anchors_in = c.get("anchor_descriptions") or {}
    if not isinstance(anchors_in, dict):
        raise RubricExtractionError(
            f"Criterion '{name}' anchor_descriptions must be a JSON object"
        )
    expected_keys = {str(v) for v in range(scale_min, scale_max + 1)}
    anchors: dict[str, str] = {}
    for k, v in anchors_in.items():
        anchors[str(k).strip()] = str(v).strip() if v is not None else ""
    missing = expected_keys - set(anchors.keys())
    if missing:
        raise RubricExtractionError(
            f"Criterion '{name}' is missing anchors for: {sorted(missing)}"
        )

    feeding = c.get("feeding_question_keys") or []
    if not isinstance(feeding, list):
        feeding = []
    feeding = [str(x).strip() for x in feeding if str(x).strip()]

    weighted = c.get("weighted_question_keys") or []
    if not isinstance(weighted, list):
        weighted = []
    weighted = [str(x).strip() for x in weighted if str(x).strip()]

    return {
        "name": name,
        "description": description,
        "scale_min": scale_min,
        "scale_max": scale_max,
        "anchor_descriptions": anchors,
        "feeding_question_keys": feeding,
        "weighted_question_keys": weighted,
        "unbound_feeding_refs": [],
        "unbound_weighted_refs": [],
    }


# ============================================================
# Ref binding
# ============================================================


def _bind_refs(
    criteria: list[dict], questions: list[Question],
) -> list[dict]:
    """Resolve LLM-returned refs against the project's actual question keys.

    The LLM returns refs verbatim from the rubric ("8", "Q3", a header
    snippet). The dataset assigns its own keys at import time (q1, q2, …,
    positional among non-id columns). We bridge the two so the operator's
    rubric review is "verify pre-ticked boxes" instead of "tick from memory."

    Resolution order, per ref:
      1. Already a known key (e.g. "q3") — pass through.
      2. "Q3" / "Q03" — strip the prefix, match by key.
      3. Pure number — match by source column index (1-based, as humans count).
      4. Substring of question text (case-insensitive) — best-effort fallback.
      5. Otherwise unbound.

    If `questions` is empty (rubric uploaded before dataset), refs are left
    untouched and not flagged as unbound — the binder needs question context
    before it can fairly say a ref doesn't match.
    """
    if not criteria or not questions:
        return criteria

    by_key: dict[str, str] = {q.key: q.key for q in questions}
    by_col_one_based: dict[int, str] = {
        q.column_index + 1: q.key for q in questions if q.column_index is not None
    }
    text_index: list[tuple[str, str]] = [
        (q.text.casefold(), q.key) for q in questions if q.text
    ]

    out: list[dict] = []
    for c in criteria:
        bound_feeding, unbound_feeding = _bind_list(
            c.get("feeding_question_keys", []), by_key, by_col_one_based, text_index,
        )
        bound_weighted, unbound_weighted = _bind_list(
            c.get("weighted_question_keys", []), by_key, by_col_one_based, text_index,
        )
        # Drop weighted refs that didn't survive feeding binding — weighted is
        # always a subset of feeding.
        feeding_set = set(bound_feeding)
        bound_weighted = [k for k in bound_weighted if k in feeding_set]

        out.append({
            **c,
            "feeding_question_keys": bound_feeding,
            "weighted_question_keys": bound_weighted,
            "unbound_feeding_refs": unbound_feeding,
            "unbound_weighted_refs": unbound_weighted,
        })
    return out


def _bind_list(
    refs: list[str],
    by_key: dict[str, str],
    by_col_one_based: dict[int, str],
    text_index: list[tuple[str, str]],
) -> tuple[list[str], list[str]]:
    bound: list[str] = []
    unbound: list[str] = []
    seen: set[str] = set()
    for ref in refs:
        key = _resolve_ref(ref, by_key, by_col_one_based, text_index)
        if key is None:
            unbound.append(ref)
            continue
        if key in seen:
            continue   # de-dupe — multiple refs may resolve to the same question
        seen.add(key)
        bound.append(key)
    return bound, unbound


_Q_PREFIX_RX = re.compile(r"^[Qq]0*(\d+)$")
_PURE_NUM_RX = re.compile(r"^\d+$")


def _resolve_ref(
    ref: str,
    by_key: dict[str, str],
    by_col_one_based: dict[int, str],
    text_index: list[tuple[str, str]],
) -> str | None:
    s = (ref or "").strip()
    if not s:
        return None
    if s in by_key:
        return by_key[s]
    m = _Q_PREFIX_RX.match(s)
    if m:
        candidate = f"q{int(m.group(1))}"
        if candidate in by_key:
            return by_key[candidate]
    if _PURE_NUM_RX.match(s):
        n = int(s)
        if n in by_col_one_based:
            return by_col_one_based[n]
        # Fall back: maybe the rubric counts only question columns (skipping
        # the ID column), so "9" really means q9.
        candidate = f"q{n}"
        if candidate in by_key:
            return by_key[candidate]
        return None
    # Substring match against question text
    needle = s.casefold()
    for hay, key in text_index:
        if needle in hay or hay in needle:
            return key
    return None


def _strip_json_fence(s: str) -> str:
    """LLMs occasionally wrap JSON in ```json fences or add a preamble."""
    s = s.strip()
    # Match a ```json ... ``` or ``` ... ``` block
    fence = re.search(r"```(?:json)?\s*(\{.*\})\s*```", s, re.DOTALL)
    if fence:
        return fence.group(1)
    # If the response starts with text, find the first { and last }
    first = s.find("{")
    last = s.rfind("}")
    if first != -1 and last > first:
        return s[first : last + 1]
    return s


# ------------------------------------------------------------------ #
# File text extraction                                               #
# ------------------------------------------------------------------ #


def _extract_text_from_file(file_bytes: bytes, filename: str) -> str:
    """txt/md → as-is. docx → python-docx. PDF deliberately unsupported in v1."""
    name = filename.lower()
    if name.endswith(".txt") or name.endswith(".md"):
        try:
            return file_bytes.decode("utf-8", errors="replace")
        except Exception as e:
            raise RubricExtractionError(f"Could not decode {filename}: {e}")
    if name.endswith(".docx"):
        try:
            from docx import Document
        except ImportError:
            raise RubricExtractionError(
                "python-docx is not installed; .docx not supported in this build"
            )
        try:
            doc = Document(io.BytesIO(file_bytes))
        except Exception as e:
            raise RubricExtractionError(f"Could not open {filename}: {e}")
        paragraphs = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
        return "\n\n".join(paragraphs)
    if name.endswith(".pdf"):
        raise RubricExtractionError(
            "PDF rubrics are not supported yet — paste the text directly or save as .docx / .txt"
        )
    raise RubricExtractionError(
        f"Unsupported file type: {filename} (use .txt, .md, or .docx)"
    )


