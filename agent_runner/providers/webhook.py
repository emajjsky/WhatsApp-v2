from __future__ import annotations

import json
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


def _optional_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class WebhookConfig:
    provider_type: str
    endpoint_url: str
    method: str
    authorization: str | None
    api_key: str | None
    response_path: str | None
    timeout_seconds: float


def _load_config(config: Mapping[str, Any] | None, provider_type: str) -> WebhookConfig:
    cfg = config or {}
    endpoint_url = _optional_str(cfg.get("endpoint_url")) or _optional_str(cfg.get("base_url"))
    if not endpoint_url:
        raise ProviderError(f"{provider_type} provider requires endpoint_url")

    method = (_optional_str(cfg.get("method")) or "POST").upper()
    if method not in {"POST", "PUT", "PATCH"}:
        raise ProviderError(f"{provider_type} provider only supports POST, PUT, or PATCH")

    return WebhookConfig(
        provider_type=provider_type,
        endpoint_url=endpoint_url,
        method=method,
        authorization=_optional_str(cfg.get("authorization")),
        api_key=_optional_str(cfg.get("api_key")),
        response_path=_optional_str(cfg.get("response_path")),
        timeout_seconds=_optional_float(cfg.get("timeout_seconds"), 30.0),
    )


def _build_payload(request: ProviderRequest) -> dict[str, Any]:
    return {
        "rule_name": request.rule_name,
        "prompt_template": request.prompt_template,
        "chat_title": request.chat_title,
        "customer_message": request.customer_message,
        "recent_messages": request.recent_messages,
        "knowledge": {
            "summary": request.knowledge_summary,
            "references": request.knowledge_references,
        },
        "metadata": request.metadata,
    }


def _extract_path(payload: Any, path: str) -> Any:
    current = payload
    for part in path.split("."):
        key = part.strip()
        if key == "":
            continue
        if isinstance(current, list) and key.isdigit():
            index = int(key)
            if index >= len(current):
                return None
            current = current[index]
            continue
        if isinstance(current, dict):
            current = current.get(key)
            continue
        return None
    return current


def _extract_draft(payload: Any, response_path: str | None) -> str:
    candidate_paths = [response_path] if response_path else []
    candidate_paths.extend(
        [
            "draft",
            "reply",
            "text",
            "message",
            "output",
            "result",
            "data.draft",
            "data.reply",
            "data.text",
            "data.output",
            "choices.0.message.content",
        ]
    )

    for path in candidate_paths:
        if not path:
            continue
        value = _extract_path(payload, path)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, (int, float)) and str(value).strip():
            return str(value).strip()

    if isinstance(payload, str) and payload.strip():
        return payload.strip()

    raise ProviderError("webhook response did not contain a draft")


class WebhookProvider(BaseProvider):
    def __init__(self, config: Mapping[str, Any] | None = None, provider_type: str = "webhook") -> None:
        self._config = _load_config(config, provider_type)
        self.name = self._config.provider_type
        self.model = self._config.provider_type

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        body = json.dumps(_build_payload(request), ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
        }
        if self._config.authorization:
            headers["Authorization"] = self._config.authorization
        elif self._config.api_key:
            headers["Authorization"] = f"Bearer {self._config.api_key}"

        req = urllib.request.Request(
            self._config.endpoint_url,
            data=body,
            method=self._config.method,
            headers=headers,
        )

        try:
            with urllib.request.urlopen(req, timeout=self._config.timeout_seconds) as resp:
                status = getattr(resp, "status", 200)
                content_type = resp.headers.get("Content-Type", "")
                raw = resp.read()
        except urllib.error.HTTPError as exc:
            try:
                detail = exc.read().decode("utf-8", errors="replace")
            except Exception:
                detail = ""
            raise ProviderError(f"{self.name} http {exc.code}: {detail}".strip()) from exc
        except urllib.error.URLError as exc:
            raise ProviderError(f"{self.name} network error: {exc.reason}") from exc
        except Exception as exc:
            raise ProviderError(f"{self.name} request failed: {exc}") from exc

        if status < 200 or status >= 300:
            raise ProviderError(f"{self.name} returned status {status}")

        text = raw.decode("utf-8", errors="replace")
        if "application/json" not in content_type.lower():
            draft = text.strip()
        else:
            try:
                decoded = json.loads(text)
            except Exception as exc:
                raise ProviderError(f"{self.name} returned invalid json: {exc}") from exc
            draft = _extract_draft(decoded, self._config.response_path)

        if not draft:
            raise ProviderError(f"{self.name} returned empty draft")

        return ProviderResponse(
            provider=self.name,
            model=self.model,
            draft=draft,
            usage={"output_characters": len(draft)},
        )
