"""Rubric extraction — text → LLM → validated criteria."""

import io
import json

import pytest

from api.services.rubric_extraction_service import (
    RubricExtractionError,
    RubricExtractionService,
)


class _ScriptedLLM:
    """Test LLM that returns a fixed string from generate(). The conftest
    stub_llm fixture monkeypatches `get_llm_client`; this test installs its
    own scripted client at the module level."""

    def __init__(self, response: str):
        self._response = response
        self.calls = 0

    def score(self, system: str, user: str) -> dict:
        return {"score": 1, "reasoning": "n/a"}

    def generate(self, system: str, user: str) -> str:
        self.calls += 1
        return self._response


@pytest.fixture
def patch_llm(monkeypatch: pytest.MonkeyPatch):
    """Helper to install a scripted LLM for a single test."""
    def install(response: str) -> _ScriptedLLM:
        client = _ScriptedLLM(response)
        import api.services.rubric_extraction_service as mod
        monkeypatch.setattr(mod, "get_llm_client", lambda: client)
        return client
    return install


# ------------------------------------------------------------------ #
# Happy paths                                                        #
# ------------------------------------------------------------------ #


def test_extract_clean_json(patch_llm):
    response = json.dumps({
        "criteria": [
            {
                "name": "team_capability",
                "description": "Team experience and skills",
                "scale_min": 1,
                "scale_max": 3,
                "anchor_descriptions": {"1": "weak", "2": "ok", "3": "strong"},
                "feeding_question_keys": ["team"],
                "weighted_question_keys": [],
            },
        ],
    })
    patch_llm(response)

    criteria = RubricExtractionService().extract_from_text("Team capability is judged on Q: team")
    assert len(criteria) == 1
    c = criteria[0]
    assert c["name"] == "team_capability"
    assert c["scale_min"] == 1 and c["scale_max"] == 3
    assert c["anchor_descriptions"]["1"] == "weak"
    assert c["feeding_question_keys"] == ["team"]


def test_extract_strips_code_fence(patch_llm):
    """LLMs often wrap JSON in ```json fences."""
    response = "```json\n" + json.dumps({
        "criteria": [
            {
                "name": "clarity",
                "description": "Is the answer clear?",
                "scale_min": 1, "scale_max": 5,
                "anchor_descriptions": {
                    "1": "unclear", "2": "vague", "3": "ok", "4": "clear", "5": "crystal",
                },
            },
        ],
    }) + "\n```"
    patch_llm(response)

    criteria = RubricExtractionService().extract_from_text("Clarity 1-5...")
    assert criteria[0]["name"] == "clarity"
    assert len(criteria[0]["anchor_descriptions"]) == 5


def test_extract_strips_preamble(patch_llm):
    """LLMs sometimes add 'Here is the JSON:' before the JSON."""
    response = (
        "Here is the structured rubric you asked for:\n"
        + json.dumps({
            "criteria": [
                {
                    "name": "fit",
                    "description": "How well it fits",
                    "scale_min": 1, "scale_max": 3,
                    "anchor_descriptions": {"1": "low", "2": "med", "3": "high"},
                },
            ],
        })
        + "\n\nLet me know if you need anything else."
    )
    patch_llm(response)

    criteria = RubricExtractionService().extract_from_text("Fit on 1-3 scale")
    assert criteria[0]["name"] == "fit"


def test_extract_normalizes_missing_lists(patch_llm):
    """Missing feeding/weighted arrays default to []."""
    response = json.dumps({
        "criteria": [
            {
                "name": "x",
                "description": "X",
                "scale_min": 1, "scale_max": 3,
                "anchor_descriptions": {"1": "a", "2": "b", "3": "c"},
            },
        ],
    })
    patch_llm(response)

    criteria = RubricExtractionService().extract_from_text("anything")
    assert criteria[0]["feeding_question_keys"] == []
    assert criteria[0]["weighted_question_keys"] == []


# ------------------------------------------------------------------ #
# Validation errors                                                  #
# ------------------------------------------------------------------ #


def test_extract_rejects_empty_text():
    with pytest.raises(RubricExtractionError, match="Empty"):
        RubricExtractionService().extract_from_text("   ")


def test_extract_rejects_invalid_json(patch_llm):
    patch_llm("This is not JSON at all")
    with pytest.raises(RubricExtractionError, match="malformed JSON"):
        RubricExtractionService().extract_from_text("rubric text")


def test_extract_rejects_missing_criteria_key(patch_llm):
    patch_llm(json.dumps({"foo": "bar"}))
    with pytest.raises(RubricExtractionError, match="missing top-level 'criteria' key"):
        RubricExtractionService().extract_from_text("rubric text")


def test_extract_rejects_empty_criteria_list(patch_llm):
    patch_llm(json.dumps({"criteria": []}))
    with pytest.raises(RubricExtractionError, match="No criteria extracted"):
        RubricExtractionService().extract_from_text("rubric text")


def test_extract_rejects_criterion_missing_name(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"description": "x", "scale_min": 1, "scale_max": 3,
             "anchor_descriptions": {"1": "a", "2": "b", "3": "c"}},
        ],
    }))
    with pytest.raises(RubricExtractionError, match="missing a name"):
        RubricExtractionService().extract_from_text("text")


def test_extract_rejects_missing_anchors(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"name": "team", "description": "team",
             "scale_min": 1, "scale_max": 5,
             "anchor_descriptions": {"1": "weak", "5": "top"}},  # 2,3,4 missing
        ],
    }))
    with pytest.raises(RubricExtractionError, match="missing anchors"):
        RubricExtractionService().extract_from_text("text")


def test_extract_rejects_inverted_scale(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"name": "x", "description": "x",
             "scale_min": 5, "scale_max": 1,
             "anchor_descriptions": {"1": "a", "2": "b", "3": "c", "4": "d", "5": "e"}},
        ],
    }))
    with pytest.raises(RubricExtractionError, match="scale_max"):
        RubricExtractionService().extract_from_text("text")


# ------------------------------------------------------------------ #
# File extraction                                                    #
# ------------------------------------------------------------------ #


def test_extract_from_txt_file(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"name": "c1", "description": "c1",
             "scale_min": 1, "scale_max": 3,
             "anchor_descriptions": {"1": "a", "2": "b", "3": "c"}},
        ],
    }))

    text_bytes = "Some rubric text".encode("utf-8")
    criteria = RubricExtractionService().extract_from_file(text_bytes, "rubric.txt")
    assert criteria[0]["name"] == "c1"


def test_extract_from_md_file(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"name": "c1", "description": "c1",
             "scale_min": 1, "scale_max": 3,
             "anchor_descriptions": {"1": "a", "2": "b", "3": "c"}},
        ],
    }))

    md = "# Rubric\n\n## Criterion 1\nDescription".encode("utf-8")
    criteria = RubricExtractionService().extract_from_file(md, "rubric.md")
    assert len(criteria) == 1


def test_extract_from_docx_file(patch_llm):
    patch_llm(json.dumps({
        "criteria": [
            {"name": "c1", "description": "c1",
             "scale_min": 1, "scale_max": 3,
             "anchor_descriptions": {"1": "a", "2": "b", "3": "c"}},
        ],
    }))

    # Build a real docx in-memory using python-docx
    from docx import Document
    doc = Document()
    doc.add_paragraph("Criterion 1: clarity")
    doc.add_paragraph("Score 1-3 scale")
    buf = io.BytesIO()
    doc.save(buf)
    buf.seek(0)

    criteria = RubricExtractionService().extract_from_file(buf.getvalue(), "rubric.docx")
    assert criteria[0]["name"] == "c1"


def test_extract_rejects_pdf():
    """PDF deliberately unsupported in v1; clear error message."""
    with pytest.raises(RubricExtractionError, match="PDF rubrics are not supported"):
        RubricExtractionService().extract_from_file(b"%PDF-1.4...", "rubric.pdf")


def test_extract_rejects_unknown_extension():
    with pytest.raises(RubricExtractionError, match="Unsupported file type"):
        RubricExtractionService().extract_from_file(b"x", "rubric.zip")
