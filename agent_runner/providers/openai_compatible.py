from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Mapping

from .base import BaseProvider, ProviderError, ProviderRequest, ProviderResponse


def _optional_str(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _optional_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _optional_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_base_url(value: str) -> str:
    base = value.strip().rstrip("/")
    if not base:
        return ""
    if base.endswith("/chat/completions"):
        base = base[: -len("/chat/completions")].rstrip("/")
    if base.endswith("/v1"):
        return base
    return base + "/v1"


def _build_user_message(request: ProviderRequest) -> str:
    lines: list[str] = []

    if request.knowledge_summary:
        summary = request.knowledge_summary.strip()
        if summary:
            lines.append("[知识摘要]")
            lines.append(summary)
            lines.append("")

    references = [ref.strip() for ref in request.knowledge_references if ref.strip()]
    if references:
        lines.append("[知识引用]")
        for ref in references:
            lines.append(f"- {ref}")
        lines.append("")

    if request.chat_title:
        lines.append("[会话标题]")
        lines.append(request.chat_title.strip())
        lines.append("")

    recent_messages = request.recent_messages or []
    if recent_messages:
        lines.append("[最近消息]")
        for item in recent_messages:
            role = _optional_str(item.get("role")) or "unknown"
            text = _optional_str(item.get("text")) or ""
            if not text:
                continue
            lines.append(f"- {role}: {text}")
        lines.append("")

    lines.append("[客户消息]")
    lines.append(request.customer_message.strip() or "")
    lines.append("")
    lines.append("请生成给客户的下一条回复，只输出回复正文。")

    return "\n".join(lines).strip()


@dataclass(frozen=True)
class OpenAICompatibleConfig:
    base_url: str
    api_key: str
    model: str
    temperature: float
    max_tokens: int
    timeout_seconds: float


def _load_config(config: Mapping[str, Any] | None) -> OpenAICompatibleConfig:
    cfg = config or {}

    base_url = _optional_str(cfg.get("base_url")) or os.getenv("OPENAI_COMPAT_BASE_URL", "").strip()
    api_key = _optional_str(cfg.get("api_key")) or os.getenv("OPENAI_COMPAT_API_KEY", "").strip()
    model = _optional_str(cfg.get("model")) or os.getenv("OPENAI_COMPAT_MODEL", "").strip() or "gpt-4o-mini"

    temperature = _optional_float(cfg.get("temperature"))
    if temperature is None:
        temperature = _optional_float(os.getenv("OPENAI_COMPAT_TEMPERATURE"))
    if temperature is None:
        temperature = 0.2

    max_tokens = _optional_int(cfg.get("max_tokens"))
    if max_tokens is None:
        max_tokens = _optional_int(os.getenv("OPENAI_COMPAT_MAX_TOKENS"))
    if max_tokens is None:
        max_tokens = 320

    timeout_seconds = _optional_float(cfg.get("timeout_seconds"))
    if timeout_seconds is None:
        timeout_seconds = _optional_float(os.getenv("OPENAI_COMPAT_TIMEOUT_SECONDS"))
    if timeout_seconds is None:
        timeout_seconds = 25.0

    base_url = _normalize_base_url(base_url)

    if not base_url:
        raise ProviderError("openai_compatible provider requires OPENAI_COMPAT_BASE_URL")
    if not api_key:
        raise ProviderError("openai_compatible provider requires OPENAI_COMPAT_API_KEY")

    return OpenAICompatibleConfig(
        base_url=base_url,
        api_key=api_key,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout_seconds=timeout_seconds,
    )


def _parse_chat_completion_response(payload: dict[str, Any]) -> tuple[str, dict[str, int]]:
    choices = payload.get("choices", [])
    if not isinstance(choices, list) or not choices:
        raise ProviderError("openai_compatible response is missing choices")

    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    content = message.get("content")

    text: str | None = None
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        # Some providers return content parts; join best-effort.
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                value = item.get("text")
                if isinstance(value, str):
                    parts.append(value)
        text = "\n".join(parts)

    if not text or not text.strip():
        raise ProviderError("openai_compatible response contained empty content")

    usage = payload.get("usage") or {}
    usage_out: dict[str, int] = {}
    if isinstance(usage, dict):
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            value = usage.get(key)
            if isinstance(value, int):
                usage_out[key] = value

    return text.strip(), usage_out


class OpenAICompatibleProvider(BaseProvider):
    name = "openai_compatible"

    def __init__(self, config: Mapping[str, Any] | None = None) -> None:
        self._config = _load_config(config)
        self.model = self._config.model

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        system_prompt = request.prompt_template.strip()
        if not system_prompt:
            raise ProviderError("openai_compatible provider requires a non-empty prompt_template")

        user_message = _build_user_message(request)

        body = {
            "model": self._config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "temperature": self._config.temperature,
            "max_tokens": self._config.max_tokens,
        }

        endpoint = self._config.base_url + "/chat/completions"
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")

        req = urllib.request.Request(
            endpoint,
            data=raw,
            method="POST",
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {self._config.api_key}",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=self._config.timeout_seconds) as resp:
                status = getattr(resp, "status", 200)
                data = resp.read()
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = ""
            raise ProviderError(f"openai_compatible http {exc.code}: {detail}".strip()) from exc
        except urllib.error.URLError as exc:
            raise ProviderError(f"openai_compatible network error: {exc.reason}") from exc
        except Exception as exc:
            raise ProviderError(f"openai_compatible request failed: {exc}") from exc

        if status < 200 or status >= 300:
            raise ProviderError(f"openai_compatible returned status {status}")

        try:
            decoded = json.loads(data.decode("utf-8"))
        except Exception as exc:
            raise ProviderError(f"openai_compatible returned invalid json: {exc}") from exc
        if not isinstance(decoded, dict):
            raise ProviderError("openai_compatible returned non-object json")

        draft, usage = _parse_chat_completion_response(decoded)

        return ProviderResponse(
            provider=self.name,
            model=self._config.model,
            draft=draft,
            usage=usage,
        )
