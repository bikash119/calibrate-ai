"""Abstract LLM client with Claude and Gemini implementations."""

import json
import logging
import os
import time
from abc import ABC, abstractmethod

logger = logging.getLogger("scoring_ai.llm_client")

MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # seconds


def _recover_truncated_json(text: str) -> dict | None:
    """Try to extract score and reasoning from truncated JSON."""
    import re

    score_match = re.search(r'"score"\s*:\s*(\d)', text)
    reasoning_match = re.search(r'"reasoning"\s*:\s*"(.*)', text, re.DOTALL)

    if not score_match:
        return None

    score = int(score_match.group(1))
    reasoning = ""
    if reasoning_match:
        reasoning = reasoning_match.group(1)
        # Clean up: remove trailing incomplete JSON artifacts
        reasoning = re.sub(r'"\s*\}?\s*$', '', reasoning)
        reasoning = reasoning.replace('\\"', '"').replace('\\n', ' ')
        reasoning += " [truncated]"

    logger.warning("Recovered truncated JSON: score=%d, reasoning_len=%d", score, len(reasoning))
    return {"score": score, "reasoning": reasoning}


def parse_llm_json_response(
    response_text: str, scale_min: int = 1, scale_max: int = 3,
) -> dict:
    """Parse JSON from LLM response, handling markdown code blocks.

    Shared utility used by all LLM clients and batch_scorer.

    Args:
        response_text: Raw text response from the LLM
        scale_min: Minimum valid score (default 1)
        scale_max: Maximum valid score (default 3)

    Returns:
        Dictionary with 'score' (int) and 'reasoning' (str)
    """
    text = response_text.strip()

    # Handle markdown JSON code blocks
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]

    if text.endswith("```"):
        text = text[:-3]

    text = text.strip()

    try:
        result = json.loads(text)
    except json.JSONDecodeError:
        # Try to recover from truncated JSON (e.g. max_output_tokens hit)
        result = _recover_truncated_json(text)
        if not result:
            logger.error("Failed to parse JSON from LLM response: %s", response_text[:300])
            return {
                "score": scale_min,
                "reasoning": f"Failed to parse LLM response: {response_text[:200]}",
            }

    # Validate expected fields
    if "score" not in result:
        logger.warning("LLM response missing 'score' field, defaulting to %d", scale_min)
        result["score"] = scale_min
    if "reasoning" not in result:
        logger.warning("LLM response missing 'reasoning' field")
        result["reasoning"] = "No reasoning provided"

    # Ensure score is in valid range
    result["score"] = max(scale_min, min(scale_max, int(result["score"])))

    return result


class RateLimitError(Exception):
    """Raised when the LLM API returns a rate limit (429) error."""
    pass


class LLMClient(ABC):
    """Abstract base class for LLM clients."""

    @abstractmethod
    def score(self, system_prompt: str, user_prompt: str) -> dict:
        """
        Send a scoring prompt to the LLM and get a structured response.

        Args:
            system_prompt: The system prompt defining the evaluator role
            user_prompt: The user prompt with criterion and answers

        Returns:
            Dictionary with 'score' (int 1-3) and 'reasoning' (str)
        """
        pass

    @staticmethod
    def parse_score_response(
        response_text: str, scale_min: int = 1, scale_max: int = 3,
    ) -> dict:
        """Parse a scoring response from the LLM.

        Each subclass overrides this with model-specific parsing.
        Base implementation uses the shared parse_llm_json_response().

        Returns:
            Dictionary with 'score' (int) and 'reasoning' (str)
        """
        return parse_llm_json_response(response_text, scale_min, scale_max)

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """
        Send a prompt to the LLM and get a raw text response (no JSON parsing).

        Used for meta-analysis tasks like feedback pattern analysis and prompt
        improvement suggestions where the response format differs from scoring.

        Args:
            system_prompt: The system instruction
            user_prompt: The user prompt

        Returns:
            Raw text response from the LLM
        """
        # Default: subclasses should override for raw text access
        result = self.score(system_prompt, user_prompt)
        return result.get("reasoning", "")


class ClaudeClient(LLMClient):
    """Claude API client using Anthropic SDK."""

    def __init__(self, api_key: str | None = None, model: str = "claude-sonnet-4-20250514"):
        """
        Initialize Claude client.

        Args:
            api_key: Anthropic API key (defaults to ANTHROPIC_API_KEY env var)
            model: Model to use (defaults to claude-sonnet-4-20250514)
        """
        import anthropic

        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not self.api_key:
            raise ValueError("ANTHROPIC_API_KEY environment variable is required")

        self.client = anthropic.Anthropic(api_key=self.api_key)
        self.model = model
        logger.info("Initialized ClaudeClient with model=%s", model)

    @staticmethod
    def parse_score_response(
        response_text: str, scale_min: int = 1, scale_max: int = 3,
    ) -> dict:
        """Parse Claude scoring response.

        Claude returns clean flat JSON: {"score": N, "reasoning": "..."}
        May occasionally be wrapped in markdown code blocks or truncated.
        """
        return parse_llm_json_response(response_text, scale_min, scale_max)

    def score(self, system_prompt: str, user_prompt: str) -> dict:
        """Send scoring prompt to Claude and parse JSON response."""
        logger.info("Claude API call: model=%s prompt_length=%d", self.model, len(user_prompt))
        start = time.time()
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except Exception:
            logger.exception("Claude API call failed")
            raise
        elapsed = time.time() - start

        # Extract text content
        response_text = message.content[0].text
        logger.info(
            "Claude API response: %.1fs, usage=%s, response_length=%d",
            elapsed,
            getattr(message, "usage", "N/A"),
            len(response_text),
        )
        logger.debug("Claude raw response: %s", response_text[:500])

        return self.parse_score_response(response_text)

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """Send prompt to Claude and return raw text response."""
        logger.info("Claude generate call: model=%s prompt_length=%d", self.model, len(user_prompt))
        start = time.time()
        try:
            message = self.client.messages.create(
                model=self.model,
                max_tokens=4096,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
        except Exception:
            logger.exception("Claude generate call failed")
            raise
        elapsed = time.time() - start
        response_text = message.content[0].text
        logger.info("Claude generate response: %.1fs, response_length=%d", elapsed, len(response_text))
        return response_text


class GeminiClient(LLMClient):
    """Google Gemini API client."""

    def __init__(self, api_key: str | None = None, model: str = "gemini-2.0-flash-lite"):
        """
        Initialize Gemini client.

        Auth priority:
        1. Explicit api_key parameter
        2. GOOGLE_API_KEY environment variable
        3. Vertex AI with service account (GCP_PROJECT + GCP_LOCATION env vars)

        Args:
            api_key: Google API key (optional, falls back to Vertex AI)
            model: Model to use (defaults to gemini-2.0-flash-lite)
        """
        from google import genai

        self.api_key = api_key or os.environ.get("GOOGLE_API_KEY")
        if self.api_key:
            self.client = genai.Client(api_key=self.api_key)
            logger.info("Initialized GeminiClient with API key, model=%s", model)
        else:
            # Fall back to Vertex AI with service account credentials
            project = os.environ.get("GCP_PROJECT")
            location = os.environ.get("GCP_LOCATION", "europe-west4")
            self.client = genai.Client(vertexai=True, project=project, location=location)
            logger.info("Initialized GeminiClient with Vertex AI (project=%s, location=%s), model=%s", project, location, model)

        self.model = model

    @staticmethod
    def parse_score_response(
        response_text: str, scale_min: int = 1, scale_max: int = 3,
    ) -> dict:
        """Parse Gemini scoring response.

        Gemini has several quirks compared to Claude:
        - Often wraps JSON in markdown code blocks: ```json ... ```
        - Wraps score in a criterion name key: {"criterion_name": {"score": 2, "reasoning": "..."}}
        - Sometimes returns plain text with no JSON at all
        - Sometimes truncates the response mid-JSON (reasoning before score = score lost)
        """
        import re

        text = response_text.strip()

        # Strip markdown code blocks (greedy to handle nested braces)
        code_block_match = re.search(r'```(?:json)?\s*(\{.*\})\s*```', text, re.DOTALL)
        if code_block_match:
            text = code_block_match.group(1)
        elif not text.startswith('{'):
            # Try to find JSON object anywhere in the text
            brace_match = re.search(r'(\{.*\})', text, re.DOTALL)
            if brace_match:
                text = brace_match.group(1)

        try:
            parsed = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            # Try truncated JSON recovery — search for "score": N anywhere in raw text
            recovered = _recover_truncated_json(response_text)
            if recovered:
                return recovered
            # Plain text response — no JSON at all
            logger.warning("Gemini returned plain text (no JSON): %.100s", response_text[:100])
            return {"score": 0, "reasoning": response_text.strip()}

        # Flat format: {"score": N, "reasoning": "..."}
        if "score" in parsed or "reasoning" in parsed:
            score = max(scale_min, min(scale_max, int(parsed["score"]))) if "score" in parsed else 0
            return {
                "score": score,
                "reasoning": str(parsed.get("reasoning", "No reasoning provided")),
            }

        # Gemini wraps in criterion name key: {"criterion_name": {"score": N, ...}}
        if len(parsed) == 1:
            inner = next(iter(parsed.values()))
            if isinstance(inner, dict) and ("score" in inner or "reasoning" in inner):
                score = max(scale_min, min(scale_max, int(inner["score"]))) if "score" in inner else 0
                return {
                    "score": score,
                    "reasoning": str(inner.get("reasoning", "No reasoning provided")),
                }

        # Multi-key nested: iterate all values looking for a dict with score/reasoning
        for v in parsed.values():
            if isinstance(v, dict) and ("score" in v or "reasoning" in v):
                score = max(scale_min, min(scale_max, int(v["score"]))) if "score" in v else 0
                return {
                    "score": score,
                    "reasoning": str(v.get("reasoning", "No reasoning provided")),
                }

        logger.warning("Gemini returned unexpected JSON structure: %.200s", text[:200])
        return {"score": 0, "reasoning": f"Unexpected response format: {text[:500]}"}

    def score(self, system_prompt: str, user_prompt: str) -> dict:
        """Send scoring prompt to Gemini and parse JSON response."""
        from google.genai import types
        from google.genai.errors import ClientError

        logger.info("Gemini API call: model=%s prompt_length=%d", self.model, len(user_prompt))
        start = time.time()

        last_error = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                    ),
                )
                elapsed = time.time() - start
                response_text = response.text
                logger.info("Gemini API response: %.1fs, response_length=%d", elapsed, len(response_text))
                logger.debug("Gemini raw response: %s", response_text[:500])
                return self.parse_score_response(response_text)

            except ClientError as e:
                last_error = e
                status = getattr(e, "status_code", None) or getattr(e, "code", None)
                if status == 429:
                    if attempt < MAX_RETRIES:
                        delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                        logger.warning(
                            "Gemini rate limited (429), retrying in %ds (attempt %d/%d)",
                            delay, attempt, MAX_RETRIES,
                        )
                        time.sleep(delay)
                        continue
                    else:
                        logger.error("Gemini rate limited (429) after %d attempts", MAX_RETRIES)
                        raise RateLimitError(
                            "Gemini API rate limit exceeded. Please wait a moment and try again."
                        ) from e
                else:
                    logger.exception("Gemini API call failed: %s", e)
                    raise
            except Exception:
                logger.exception("Gemini API call failed")
                raise

        raise last_error  # should not reach here

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """Send prompt to Gemini and return raw text response."""
        from google.genai import types
        from google.genai.errors import ClientError

        logger.info("Gemini generate call: model=%s prompt_length=%d", self.model, len(user_prompt))
        start = time.time()

        last_error = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        max_output_tokens=4096,
                    ),
                )
                elapsed = time.time() - start
                response_text = response.text
                logger.info("Gemini generate response: %.1fs, response_length=%d", elapsed, len(response_text))
                return response_text

            except ClientError as e:
                last_error = e
                status = getattr(e, "status_code", None) or getattr(e, "code", None)
                if status == 429:
                    if attempt < MAX_RETRIES:
                        delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                        logger.warning(
                            "Gemini rate limited (429), retrying in %ds (attempt %d/%d)",
                            delay, attempt, MAX_RETRIES,
                        )
                        time.sleep(delay)
                        continue
                    else:
                        logger.error("Gemini rate limited (429) after %d attempts", MAX_RETRIES)
                        raise RateLimitError(
                            "Gemini API rate limit exceeded. Please wait a moment and try again."
                        ) from e
                else:
                    logger.exception("Gemini generate call failed: %s", e)
                    raise
            except Exception:
                logger.exception("Gemini generate call failed")
                raise

        raise last_error  # should not reach here

    def generate_long(self, system_prompt: str, user_prompt: str) -> str:
        """Generate with higher output token limit for meta-reasoning tasks like prompt improvement."""
        from google.genai import types
        from google.genai.errors import ClientError

        logger.info("Gemini generate_long call: model=%s prompt_length=%d", self.model, len(user_prompt))
        start = time.time()

        last_error = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                response = self.client.models.generate_content(
                    model=self.model,
                    contents=user_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_prompt,
                        max_output_tokens=16384,
                    ),
                )
                elapsed = time.time() - start
                response_text = response.text
                logger.info("Gemini generate_long response: %.1fs, response_length=%d", elapsed, len(response_text))
                return response_text

            except ClientError as e:
                last_error = e
                status = getattr(e, "status_code", None) or getattr(e, "code", None)
                if status == 429:
                    if attempt < MAX_RETRIES:
                        delay = RETRY_BASE_DELAY * (2 ** (attempt - 1))
                        logger.warning(
                            "Gemini rate limited (429), retrying in %ds (attempt %d/%d)",
                            delay, attempt, MAX_RETRIES,
                        )
                        time.sleep(delay)
                        continue
                    else:
                        raise RateLimitError(
                            "Gemini API rate limit exceeded. Please wait a moment and try again."
                        ) from e
                else:
                    logger.exception("Gemini generate_long call failed: %s", e)
                    raise
            except Exception:
                logger.exception("Gemini generate_long call failed")
                raise

        raise last_error  # should not reach here


def get_llm_client(provider: str | None = None) -> LLMClient:
    """
    Factory function to get the appropriate LLM client.

    Args:
        provider: 'claude' or 'gemini' (defaults to LLM_PROVIDER env var or 'claude')

    Returns:
        LLMClient instance
    """
    provider = provider or os.environ.get("LLM_PROVIDER", "gemini")
    provider = provider.lower()
    logger.info("Creating LLM client: provider=%s", provider)

    if provider == "claude":
        return ClaudeClient()
    elif provider == "gemini":
        return GeminiClient()
    else:
        raise ValueError(f"Unknown LLM provider: {provider}. Use 'claude' or 'gemini'.")


def get_score_parser(
    provider: str | None = None,
    scale_min: int = 1,
    scale_max: int = 3,
):
    """Get the score response parser for the given LLM provider.

    Returns a callable that parses a response string into a score dict,
    so batch result retrieval can parse responses without instantiating a client.

    Args:
        provider: 'claude' or 'gemini' (defaults to LLM_PROVIDER env var)
        scale_min: Minimum valid score (default 1)
        scale_max: Maximum valid score (default 3)

    Returns:
        Callable[[str], dict] that parses a response into {"score": int, "reasoning": str}
    """
    from functools import partial

    provider = (provider or os.environ.get("LLM_PROVIDER", "gemini")).lower()
    if provider == "claude":
        base = ClaudeClient.parse_score_response
    elif provider == "gemini":
        base = GeminiClient.parse_score_response
    else:
        base = LLMClient.parse_score_response

    if scale_min == 1 and scale_max == 3:
        return base  # No wrapping needed for default case
    return partial(base, scale_min=scale_min, scale_max=scale_max)
