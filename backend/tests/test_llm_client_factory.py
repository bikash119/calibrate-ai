"""LLM client factory: provider/model defaults and parameter forwarding.

Pins the contract that scoring jobs and llm_client agree on defaults so
the recorded `scoring_jobs.provider` / `scoring_jobs.model` always match
what the worker actually calls.
"""

import os
from unittest.mock import patch

import pytest

import llm_client


def test_default_model_for_claude():
    assert llm_client.default_model_for("claude") == "claude-haiku-4-5"


def test_default_model_for_gemini():
    assert llm_client.default_model_for("gemini") == "gemini-2.0-flash-lite"


def test_default_model_for_unknown_falls_back_to_default_provider():
    # Garbage provider → use whatever the project's default provider is.
    fallback = llm_client.default_model_for("garbage")
    assert fallback == llm_client.DEFAULT_MODELS[llm_client.DEFAULT_PROVIDER]


def test_default_provider_matches_documentation():
    """CLAUDE.md documents `claude` as the default — keep it that way."""
    assert llm_client.DEFAULT_PROVIDER == "claude"


def test_get_llm_client_forwards_explicit_model():
    """When the worker calls get_llm_client(provider=job.provider, model=job.model),
    the constructed client must actually use that model — not the env var or
    the constructor default."""
    with patch.object(llm_client, "ClaudeClient") as mock_claude:
        llm_client.get_llm_client(provider="claude", model="claude-opus-4-7")
        mock_claude.assert_called_once_with(model="claude-opus-4-7")


def test_get_llm_client_uses_default_model_when_none(monkeypatch):
    """Caller passes provider but no model → factory picks the canonical
    default via default_model_for."""
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    with patch.object(llm_client, "GeminiClient") as mock_gemini:
        llm_client.get_llm_client(provider="gemini")
        mock_gemini.assert_called_once_with(
            model=llm_client.DEFAULT_MODELS["gemini"],
        )


def test_get_llm_client_respects_env_var(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    with patch.object(llm_client, "GeminiClient") as mock_gemini:
        llm_client.get_llm_client()  # no args
        mock_gemini.assert_called_once_with(
            model=llm_client.DEFAULT_MODELS["gemini"],
        )


def test_get_llm_client_rejects_unknown_provider():
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        llm_client.get_llm_client(provider="openai")


def test_scoring_job_service_imports_match():
    """The scoring service must consume the same defaults as the factory.
    Drift here is exactly the bug this whole refactor is meant to fix."""
    from api.services import scoring_job_service

    # Both modules expose / consume the same name.
    assert scoring_job_service.DEFAULT_PROVIDER == llm_client.DEFAULT_PROVIDER
    assert scoring_job_service.default_model_for is llm_client.default_model_for


def test_no_env_no_args_uses_default_provider_and_model(monkeypatch):
    monkeypatch.delenv("LLM_PROVIDER", raising=False)
    with patch.object(llm_client, "ClaudeClient") as mock_claude:
        llm_client.get_llm_client()
        mock_claude.assert_called_once_with(
            model=llm_client.DEFAULT_MODELS[llm_client.DEFAULT_PROVIDER],
        )


# Sanity: the env var cannot leak across tests.
def test_env_isolation():
    assert os.environ.get("LLM_PROVIDER") in (None, "claude", "gemini")
