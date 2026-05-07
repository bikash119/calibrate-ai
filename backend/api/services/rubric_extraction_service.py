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
- If the rubric implies which questions feed each criterion (e.g. "judged
  based on Q1 and Q3"), include that as feeding_question_keys (an array
  of strings); otherwise leave it as []
- description should be the rubric's prose for that criterion, lightly
  cleaned up — never invent content
- If the rubric is ambiguous on anchors, write your best guess but err
  toward the rubric's wording

Respond ONLY with valid JSON in this exact shape:
{
  "criteria": [
    {
      "name": "snake_case_name",
      "description": "what this criterion evaluates",
      "scale_min": 1,
      "scale_max": 5,
      "anchor_descriptions": {"1": "...", "2": "...", "3": "...", "4": "...", "5": "..."},
      "feeding_question_keys": []
    }
  ]
}\
"""


# ============================================================
# Service
# ============================================================


class RubricExtractionService:
    def extract_from_text(self, text: str) -> list[dict]:
        """Send free-form rubric text to the LLM, return validated criteria."""
        if not text or not text.strip():
            raise RubricExtractionError("Empty rubric text")
        if len(text) > MAX_TEXT_CHARS:
            raise RubricExtractionError(
                f"Rubric text is {len(text)} chars; max is {MAX_TEXT_CHARS}"
            )

        client = get_llm_client()
        raw = client.generate(SYSTEM_PROMPT, text.strip())
        return self._parse_response(raw)

    def extract_from_file(self, file_bytes: bytes, filename: str) -> list[dict]:
        """Read a document file (txt/md/docx), pull text, run extraction."""
        if len(file_bytes) > MAX_FILE_BYTES:
            raise RubricExtractionError(
                f"File too large ({len(file_bytes)} bytes); max is {MAX_FILE_BYTES}"
            )
        text = _extract_text_from_file(file_bytes, filename)
        return self.extract_from_text(text)

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
    }


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


