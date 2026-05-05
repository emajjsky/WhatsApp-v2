from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

try:
    from .dotenv import load_dotenv
    from .policy import evaluate_reply
    from .providers.base import ProviderError, ProviderRequest, ProviderResponse, available_providers, build_provider
except ImportError:
    from dotenv import load_dotenv
    from policy import evaluate_reply
    from providers.base import ProviderError, ProviderRequest, ProviderResponse, available_providers, build_provider


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class RunnerConfig:
    # Use default_factory to ensure `.env` is loaded before reading env vars.
    host: str = field(default_factory=lambda: os.getenv("AGENT_RUNNER_HOST", "127.0.0.1"))
    port: int = field(default_factory=lambda: int(os.getenv("AGENT_RUNNER_PORT", "8090")))
    default_provider: str = field(
        default_factory=lambda: os.getenv("AGENT_RUNNER_DEFAULT_PROVIDER", "mock").strip() or "mock"
    )


class AgentRunnerHandler(BaseHTTPRequestHandler):
    server_version = "agent-runner/0.1"

    def do_GET(self) -> None:
        route = urlparse(self.path).path

        if route == "/healthz":
            self.respond(
                HTTPStatus.OK,
                {
                    "service": "agent-runner",
                    "status": "ok",
                    "timestamp": utc_now().isoformat(),
                    "default_provider": self.server.config.default_provider,
                    "providers": available_providers(),
                },
            )
            return

        if route == "/v1/providers":
            self.respond(HTTPStatus.OK, {"providers": available_providers()})
            return

        self.respond(HTTPStatus.NOT_FOUND, {"error": "route not found"})

    def do_POST(self) -> None:
        route = urlparse(self.path).path

        if route == "/v1/runs":
            self.handle_run_request()
            return
        if route == "/v1/runs/stream":
            self.handle_stream_request()
            return
        if route == "/v1/translations":
            self.handle_translation_request()
            return
        if route == "/v1/status-card":
            self.handle_status_card_request()
            return

        self.respond(HTTPStatus.NOT_FOUND, {"error": "route not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return

    def handle_run_request(self) -> None:
        try:
            payload = self.read_json()
            response = self.server.handle_run(payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except ProviderError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except Exception as exc:
            self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"internal runner error: {exc}"})
            return

        self.respond(HTTPStatus.OK, response)

    def handle_stream_request(self) -> None:
        try:
            payload = self.read_json()
            stream = self.server.prepare_run_stream(payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except ProviderError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except Exception as exc:
            self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"internal runner error: {exc}"})
            return

        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        try:
            for event in stream:
                self.write_ndjson(event)
        except ProviderError as exc:
            self.write_ndjson({"type": "error", "error": str(exc)})
        except Exception as exc:
            self.write_ndjson({"type": "error", "error": f"internal runner error: {exc}"})

    def handle_translation_request(self) -> None:
        try:
            payload = self.read_json()
            response = self.server.handle_translation(payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except ProviderError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except Exception as exc:
            self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"internal runner error: {exc}"})
            return

        self.respond(HTTPStatus.OK, response)

    def handle_status_card_request(self) -> None:
        try:
            payload = self.read_json()
            response = self.server.handle_status_card(payload)
        except ValueError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except ProviderError as exc:
            self.respond(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            return
        except Exception as exc:
            self.respond(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"internal runner error: {exc}"})
            return

        self.respond(HTTPStatus.OK, response)

    def read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length > 0 else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ValueError(f"invalid json body: {exc.msg}") from exc

        if not isinstance(payload, dict):
            raise ValueError("json body must be an object")

        return payload

    def respond(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def write_ndjson(self, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8") + b"\n"
        self.wfile.write(body)
        self.wfile.flush()


class AgentRunnerServer(ThreadingHTTPServer):
    def __init__(self, config: RunnerConfig) -> None:
        super().__init__((config.host, config.port), AgentRunnerHandler)
        self.config = config

    def handle_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        run_context = self.build_run_context(payload)
        provider_response = run_context["provider"].generate(run_context["provider_request"])

        return self.build_run_response(
            run_context=run_context,
            provider_response=provider_response,
            draft=provider_response.draft,
        )

    def build_run_context(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = str(payload.get("request_id") or uuid4())
        account_id = required_string(payload, "account_id")
        chat_id = required_string(payload, "chat_id")
        trigger_message_id = required_string(payload, "trigger_message_id")
        rule = expect_object(payload.get("rule"), "rule")
        message = expect_object(payload.get("message"), "message")
        context = expect_object(payload.get("context", {}), "context")
        provider_config = expect_object(
            payload.get("provider", {"type": self.config.default_provider}),
            "provider",
        )
        customer_message = required_string(message, "text")
        recent_messages = normalize_recent_messages(context.get("recent_messages"))
        provider = build_provider(provider_config)
        provider_request = ProviderRequest(
            rule_name=required_string(rule, "name"),
            prompt_template=optional_string(rule.get("prompt_template")) or "",
            knowledge_summary=extract_knowledge_summary(rule),
            knowledge_references=extract_knowledge_references(rule),
            chat_title=optional_string(payload.get("chat_title")) or optional_string(context.get("chat_title")),
            customer_message=customer_message,
            recent_messages=recent_messages,
            metadata={
                "account_id": account_id,
                "chat_id": chat_id,
                "trigger_message_id": trigger_message_id,
            },
        )

        return {
            "request_id": request_id,
            "account_id": account_id,
            "chat_id": chat_id,
            "trigger_message_id": trigger_message_id,
            "rule": rule,
            "customer_message": customer_message,
            "recent_messages": recent_messages,
            "provider": provider,
            "provider_request": provider_request,
            "recent_auto_replies": normalize_int(payload.get("recent_auto_replies"), default=0),
        }

    def build_run_response(
        self,
        run_context: dict[str, Any],
        provider_response: ProviderResponse,
        draft: str,
    ) -> dict[str, Any]:
        decision = evaluate_reply(
            run_context["rule"],
            run_context["customer_message"],
            draft,
            run_context["recent_auto_replies"],
        )

        response: dict[str, Any] = {
            "run_id": run_context["request_id"],
            "account_id": run_context["account_id"],
            "chat_id": run_context["chat_id"],
            "trigger_message_id": run_context["trigger_message_id"],
            "status": decision.status,
            "draft": draft,
            "block_reasons": decision.block_reasons,
            "provider": {
                "type": provider_response.provider,
                "model": provider_response.model,
                "usage": provider_response.usage,
            },
            "policy": asdict(decision),
            "trace": {
                "generated_at": utc_now().isoformat(),
                "recent_message_count": len(run_context["recent_messages"]),
                "prompt_preview": run_context["provider_request"].prompt_template[:160],
            },
        }

        if decision.should_dispatch:
            response["dispatch"] = {
                "channel": "session-gateway",
                "account_id": run_context["account_id"],
                "chat_id": run_context["chat_id"],
                "message_text": draft,
            }

        return response

    def prepare_run_stream(self, payload: dict[str, Any]):
        run_context = self.build_run_context(payload)

        def iterator():
            yield {
                "type": "start",
                "run_id": run_context["request_id"],
                "account_id": run_context["account_id"],
                "chat_id": run_context["chat_id"],
                "trigger_message_id": run_context["trigger_message_id"],
            }

            draft_parts: list[str] = []
            for chunk in run_context["provider"].stream_generate(run_context["provider_request"]):
                if not chunk:
                    continue
                draft_parts.append(chunk)
                yield {"type": "delta", "text": chunk}

            draft = "".join(draft_parts).strip()
            provider_response = ProviderResponse(
                provider=run_context["provider"].name,
                model=run_context["provider"].model,
                draft=draft,
                usage={"output_characters": len(draft)},
            )
            response = self.build_run_response(run_context, provider_response, draft)
            response["type"] = "complete"
            yield response

        return iterator()

    def handle_translation(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = str(payload.get("request_id") or uuid4())
        provider_config = expect_object(
            payload.get("provider", {"type": self.config.default_provider}),
            "provider",
        )
        text = required_string(payload, "text")
        target_language = optional_string(payload.get("target_language")) or "zh-CN"
        target_language_name = optional_string(payload.get("target_language_name")) or target_language
        prompt_template = optional_string(payload.get("prompt_template")) or (
            "You are a precise translation engine for customer support. "
            "Return only strict JSON and do not add markdown."
        )

        provider = build_provider(provider_config)
        provider_response = provider.generate(
            ProviderRequest(
                rule_name="translation",
                prompt_template=prompt_template,
                knowledge_summary=None,
                knowledge_references=[],
                chat_title=None,
                customer_message=text,
                recent_messages=[],
                metadata={
                    "task": "translation",
                    "target_language": target_language,
                    "target_language_name": target_language_name,
                },
            )
        )
        translation = parse_translation_payload(provider_response.draft)

        return {
            "request_id": request_id,
            "source_language_code": translation["source_language_code"],
            "source_language_name": translation["source_language_name"],
            "target_language": target_language,
            "target_language_name": target_language_name,
            "translated_text": translation["translated_text"],
            "provider": {
                "type": provider_response.provider,
                "model": provider_response.model,
                "usage": provider_response.usage,
            },
        }

    def handle_status_card(self, payload: dict[str, Any]) -> dict[str, Any]:
        request_id = str(payload.get("request_id") or uuid4())
        account_id = required_string(payload, "account_id")
        chat_id = required_string(payload, "chat_id")
        provider_config = expect_object(
            payload.get("provider", {"type": self.config.default_provider}),
            "provider",
        )
        recent_messages = normalize_recent_messages(payload.get("recent_messages"))
        latest_customer_message = latest_message_by_role(recent_messages, "customer")
        prompt_template = optional_string(payload.get("prompt_template")) or (
            "你是 WhatsApp 私域转化顾问。基于完整聊天记录分析客户状态，只输出严格 JSON。"
        )
        stage_labels = normalize_label_list(payload.get("stage_labels"))
        customer_type_labels = normalize_label_list(payload.get("customer_type_labels"))
        risk_labels = normalize_label_list(payload.get("risk_labels"))

        provider = build_provider(provider_config)
        provider_response = provider.generate(
            ProviderRequest(
                rule_name="status_card",
                prompt_template=prompt_template,
                knowledge_summary=None,
                knowledge_references=[],
                chat_title=optional_string(payload.get("chat_title")),
                customer_message=latest_customer_message or "请基于全部会话分析客户状态。",
                recent_messages=recent_messages,
                metadata={
                    "task": "status_card",
                    "account_id": account_id,
                    "chat_id": chat_id,
                    "stage_labels": stage_labels,
                    "customer_type_labels": customer_type_labels,
                    "risk_labels": risk_labels,
                    "message_count": len(recent_messages),
                },
            )
        )
        status_card = parse_status_card_payload(provider_response.draft)

        return {
            "request_id": request_id,
            "current_stage": status_card["current_stage"],
            "customer_types": status_card["customer_types"],
            "current_risk": status_card["current_risk"],
            "summary": status_card["summary"],
            "evidence": status_card["evidence"],
            "next_action": status_card["next_action"],
            "confidence": status_card["confidence"],
            "provider": {
                "type": provider_response.provider,
                "model": provider_response.model,
                "usage": provider_response.usage,
            },
        }


def required_string(payload: dict[str, Any], key: str) -> str:
    value = optional_string(payload.get(key))
    if not value:
        raise ValueError(f"{key} is required")
    return value


def optional_string(value: Any) -> str | None:
    normalized = str(value).strip() if value is not None else ""
    return normalized or None


def normalize_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def expect_object(value: Any, field_name: str) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return value


def extract_knowledge_summary(rule: dict[str, Any]) -> str | None:
    knowledge_binding = expect_object(rule.get("knowledge_binding", {}), "rule.knowledge_binding")
    return optional_string(knowledge_binding.get("summary"))


def extract_knowledge_references(rule: dict[str, Any]) -> list[str]:
    knowledge_binding = expect_object(rule.get("knowledge_binding", {}), "rule.knowledge_binding")
    references = knowledge_binding.get("references", [])
    if not isinstance(references, list):
        return []
    return [value for item in references if (value := optional_string(item))]


def normalize_recent_messages(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    result: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        text = optional_string(item.get("text"))
        if not text:
            continue
        result.append(
            {
                "role": optional_string(item.get("role")) or "unknown",
                "text": text,
            }
        )

    return result


def normalize_label_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        label = optional_string(item)
        if not label or label in seen:
            continue
        seen.add(label)
        result.append(label)

    return result


def latest_message_by_role(messages: list[dict[str, Any]], role: str) -> str | None:
    expected_role = role.strip().lower()
    for item in reversed(messages):
        item_role = optional_string(item.get("role")) or ""
        if item_role.strip().lower() != expected_role:
            continue
        text = optional_string(item.get("text"))
        if text:
            return text
    return None


def parse_json_object_payload(text: str) -> dict[str, Any] | None:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`").strip()
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    try:
        decoded = json.loads(cleaned)
    except Exception:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            decoded = json.loads(cleaned[start : end + 1])
        except Exception:
            return None

    return decoded if isinstance(decoded, dict) else None


def parse_translation_payload(text: str) -> dict[str, str]:
    cleaned = text.strip()
    decoded = parse_json_object_payload(cleaned)
    if decoded is None:
        return {
            "source_language_code": "unknown",
            "source_language_name": "Unknown",
            "translated_text": cleaned,
        }

    return {
        "source_language_code": optional_string(decoded.get("source_language_code")) or "unknown",
        "source_language_name": optional_string(decoded.get("source_language_name")) or "Unknown",
        "translated_text": optional_string(decoded.get("translated_text")) or cleaned,
    }


def parse_status_card_payload(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    decoded = parse_json_object_payload(cleaned)
    if decoded is None:
        raise ProviderError("status card response must be strict JSON")

    customer_types = decoded.get("customer_types")
    if not isinstance(customer_types, list):
        customer_type = optional_string(decoded.get("customer_type"))
        customer_types = [customer_type] if customer_type else []

    evidence = decoded.get("evidence")
    if not isinstance(evidence, list):
        evidence_text = optional_string(evidence)
        evidence = [evidence_text] if evidence_text else []

    return {
        "current_stage": optional_string(decoded.get("current_stage")) or "新线索",
        "customer_types": normalize_label_list(customer_types),
        "current_risk": optional_string(decoded.get("current_risk")) or "低",
        "summary": optional_string(decoded.get("summary")) or "",
        "evidence": normalize_label_list(evidence),
        "next_action": optional_string(decoded.get("next_action")) or "",
        "confidence": optional_string(decoded.get("confidence")) or "",
    }


def main() -> None:
    # Convenience for local development: allow `.env` to override stale PowerShell session env vars.
    load_dotenv(override=True)
    config = RunnerConfig()
    server = AgentRunnerServer(config)
    print(
        json.dumps(
            {
                "service": "agent-runner",
                "host": config.host,
                "port": config.port,
                "default_provider": config.default_provider,
            },
            ensure_ascii=False,
        )
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
