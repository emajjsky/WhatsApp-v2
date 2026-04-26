from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections.abc import Iterator
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


def _optional_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    normalized = str(value).strip().lower()
    if normalized in {"true", "1", "yes", "on", "enabled"}:
        return True
    if normalized in {"false", "0", "no", "off", "disabled"}:
        return False
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
    if request.metadata.get("task") == "translation":
        target_language = _optional_str(request.metadata.get("target_language")) or "zh-CN"
        target_language_name = _optional_str(request.metadata.get("target_language_name")) or target_language
        return "\n".join(
            [
                "[Translation Task]",
                f"Target language: {target_language_name} ({target_language})",
                "Detect the source language, translate the text into the target language, and return only strict JSON.",
                "Use a Simplified Chinese language name for source_language_name when possible.",
                'JSON schema: {"source_language_code":"string","source_language_name":"string","translated_text":"string"}',
                "",
                "[Source Text]",
                request.customer_message.strip(),
            ]
        ).strip()

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
    enable_thinking: bool | None
    extra_body: dict[str, Any]


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

    enable_thinking = _optional_bool(cfg.get("enable_thinking"))
    extra_body = cfg.get("extra_body")
    if not isinstance(extra_body, dict):
        extra_body = {}

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
        enable_thinking=enable_thinking,
        extra_body=dict(extra_body),
    )


def _extract_content_text(content: Any) -> str | None:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
                continue
            if isinstance(item, dict):
                value = item.get("text") or item.get("content")
                if isinstance(value, str):
                    parts.append(value)
        return "\n".join(parts)
    return None


def _strip_thinking_blocks(text: str) -> str:
    result = text.strip()
    while "<think>" in result and "</think>" in result:
        start = result.find("<think>")
        end = result.find("</think>", start)
        if start < 0 or end < 0:
            break
        result = (result[:start] + result[end + len("</think>") :]).strip()
    return result


def _longest_marker_prefix_suffix(text: str, markers: list[str]) -> int:
    max_size = 0
    for marker in markers:
        upper_bound = min(len(text), len(marker) - 1)
        for size in range(1, upper_bound + 1):
            if text.endswith(marker[:size]):
                max_size = max(max_size, size)
    return max_size


class _ThinkingBlockStreamFilter:
    def __init__(self) -> None:
        self._buffer = ""
        self._inside_thinking = False

    def feed(self, text: str) -> str:
        self._buffer += text
        output: list[str] = []

        while self._buffer:
            if self._inside_thinking:
                end = self._buffer.find("</think>")
                if end < 0:
                    keep = _longest_marker_prefix_suffix(self._buffer, ["</think>"])
                    self._buffer = self._buffer[-keep:] if keep else ""
                    break
                self._buffer = self._buffer[end + len("</think>") :]
                self._inside_thinking = False
                continue

            start = self._buffer.find("<think>")
            if start >= 0:
                if start > 0:
                    output.append(self._buffer[:start])
                self._buffer = self._buffer[start + len("<think>") :]
                self._inside_thinking = True
                continue

            keep = _longest_marker_prefix_suffix(self._buffer, ["<think>"])
            if keep:
                output.append(self._buffer[:-keep])
                self._buffer = self._buffer[-keep:]
            else:
                output.append(self._buffer)
                self._buffer = ""
            break

        return "".join(output)

    def flush(self) -> str:
        if self._inside_thinking:
            self._buffer = ""
            return ""
        remainder = self._buffer
        self._buffer = ""
        return remainder


def _parse_chat_completion_response(payload: dict[str, Any]) -> tuple[str, dict[str, int]]:
    choices = payload.get("choices", [])
    if not isinstance(choices, list) or not choices:
        raise ProviderError("openai_compatible response is missing choices")

    message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    text = _extract_content_text(message.get("content"))

    if not text or not text.strip():
        if message.get("reasoning_content"):
            raise ProviderError(
                "openai_compatible response only contained reasoning content; try setting enable_thinking=false"
            )
        raise ProviderError("openai_compatible response contained empty content")

    text = _strip_thinking_blocks(text)
    if not text:
        raise ProviderError("openai_compatible response contained empty content after removing thinking blocks")

    usage = payload.get("usage") or {}
    usage_out: dict[str, int] = {}
    if isinstance(usage, dict):
        for key in ("prompt_tokens", "completion_tokens", "total_tokens"):
            value = usage.get(key)
            if isinstance(value, int):
                usage_out[key] = value

    return text.strip(), usage_out


def _build_chat_body(config: OpenAICompatibleConfig, request: ProviderRequest, stream: bool) -> dict[str, Any]:
    system_prompt = request.prompt_template.strip()
    if not system_prompt:
        raise ProviderError("openai_compatible provider requires a non-empty prompt_template")

    body: dict[str, Any] = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _build_user_message(request)},
        ],
        "temperature": config.temperature,
        "max_tokens": config.max_tokens,
    }
    if stream:
        body["stream"] = True
    if config.enable_thinking is not None:
        body["enable_thinking"] = config.enable_thinking
    body.update(config.extra_body)
    return body


class OpenAICompatibleProvider(BaseProvider):
    name = "openai_compatible"

    def __init__(self, config: Mapping[str, Any] | None = None) -> None:
        self._config = _load_config(config)
        self.model = self._config.model

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        body = _build_chat_body(self._config, request, stream=False)

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

    def stream_generate(self, request: ProviderRequest) -> Iterator[str]:
        body = _build_chat_body(self._config, request, stream=True)
        endpoint = self._config.base_url + "/chat/completions"
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        thinking_filter = _ThinkingBlockStreamFilter()
        saw_reasoning_content = False
        emitted_text = False

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
                if status < 200 or status >= 300:
                    raise ProviderError(f"openai_compatible returned status {status}")

                for raw_line in resp:
                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not line or not line.startswith("data:"):
                        continue
                    data = line[len("data:") :].strip()
                    if data == "[DONE]":
                        break
                    try:
                        payload = json.loads(data)
                    except Exception:
                        continue
                    if not isinstance(payload, dict):
                        continue

                    choices = payload.get("choices", [])
                    if not isinstance(choices, list) or not choices:
                        continue
                    delta = choices[0].get("delta", {}) if isinstance(choices[0], dict) else {}
                    if not isinstance(delta, dict):
                        continue
                    if delta.get("reasoning_content"):
                        saw_reasoning_content = True
                    text = _extract_content_text(delta.get("content"))
                    if text:
                        cleaned = thinking_filter.feed(text)
                        if cleaned:
                            emitted_text = True
                            yield cleaned
                remainder = thinking_filter.flush()
                if remainder:
                    emitted_text = True
                    yield remainder
                if saw_reasoning_content and not emitted_text:
                    raise ProviderError(
                        "openai_compatible stream only contained reasoning content; try setting enable_thinking=false"
                    )
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = ""
            raise ProviderError(f"openai_compatible http {exc.code}: {detail}".strip()) from exc
        except urllib.error.URLError as exc:
            raise ProviderError(f"openai_compatible network error: {exc.reason}") from exc
        except ProviderError:
            raise
        except Exception as exc:
            raise ProviderError(f"openai_compatible stream failed: {exc}") from exc
