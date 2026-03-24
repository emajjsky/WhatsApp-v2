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
    from .providers.base import ProviderError, ProviderRequest, available_providers, build_provider
except ImportError:
    from dotenv import load_dotenv
    from policy import evaluate_reply
    from providers.base import ProviderError, ProviderRequest, available_providers, build_provider


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


class AgentRunnerServer(ThreadingHTTPServer):
    def __init__(self, config: RunnerConfig) -> None:
        super().__init__((config.host, config.port), AgentRunnerHandler)
        self.config = config

    def handle_run(self, payload: dict[str, Any]) -> dict[str, Any]:
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
            prompt_template=required_string(rule, "prompt_template"),
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

        provider_response = provider.generate(provider_request)
        recent_auto_replies = normalize_int(payload.get("recent_auto_replies"), default=0)
        decision = evaluate_reply(rule, customer_message, provider_response.draft, recent_auto_replies)

        response: dict[str, Any] = {
            "run_id": request_id,
            "account_id": account_id,
            "chat_id": chat_id,
            "trigger_message_id": trigger_message_id,
            "status": decision.status,
            "draft": provider_response.draft,
            "block_reasons": decision.block_reasons,
            "provider": {
                "type": provider_response.provider,
                "model": provider_response.model,
                "usage": provider_response.usage,
            },
            "policy": asdict(decision),
            "trace": {
                "generated_at": utc_now().isoformat(),
                "recent_message_count": len(recent_messages),
                "prompt_preview": provider_request.prompt_template[:160],
            },
        }

        if decision.should_dispatch:
            response["dispatch"] = {
                "channel": "session-gateway",
                "account_id": account_id,
                "chat_id": chat_id,
                "message_text": provider_response.draft,
            }

        return response


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
