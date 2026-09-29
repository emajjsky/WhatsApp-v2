from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlparse
from urllib import error as urllib_error, request as urllib_request
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
        except (BrokenPipeError, ConnectionResetError):
            # The caller navigated away or cancelled the request. There is
            # no socket left on which an error envelope can be written.
            return
        except ProviderError as exc:
            try:
                self.write_ndjson({"type": "error", "error": str(exc)})
            except (BrokenPipeError, ConnectionResetError):
                return
        except Exception as exc:
            try:
                self.write_ndjson({"type": "error", "error": f"internal runner error: {exc}"})
            except (BrokenPipeError, ConnectionResetError):
                return

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

    def _apply_skill_decision(
        self,
        run_context: dict[str, Any],
        decision: dict[str, Any] | None,
        decision_error: str | None = None,
    ) -> dict[str, Any]:
        next_context = dict(run_context)
        request = run_context["provider_request"]
        if decision is None:
            if decision_error:
                next_context["provider_request"] = replace(
                    request,
                    knowledge_summary=None,
                    knowledge_references=[],
                    metadata={
                        **request.metadata,
                        "skill_lookup": "skipped_decision_error",
                        "skill_decision_error": decision_error,
                        "skill_tags": [],
                    },
                )
            return next_context

        should_use_skill = bool(decision.get("need_skill"))
        references = request.knowledge_references if should_use_skill else []
        if should_use_skill:
            references, filter_status = filter_skill_references(references, decision.get("skill_tags", []))
        else:
            filter_status = "skipped_by_decision"
        next_context["provider_request"] = replace(
            request,
            knowledge_summary=request.knowledge_summary if should_use_skill else None,
            knowledge_references=references,
            metadata={
                **request.metadata,
                "skill_lookup": "used" if should_use_skill else "skipped",
                "skill_intent": decision.get("intent", "其他"),
                "skill_tags": decision.get("skill_tags", []),
                "skill_filter": filter_status,
            },
        )
        return next_context

    def handle_run(self, payload: dict[str, Any]) -> dict[str, Any]:
        run_context = self.build_run_context(payload)
        decision, decision_error = self.run_decision(run_context)
        run_context = self._apply_skill_decision(run_context, decision, decision_error)
        run_context["decision"] = decision
        run_context["decision_error"] = decision_error
        if decision:
            request = run_context["provider_request"]
            guidance = (
                f"{request.prompt_template.strip()}\n\n"
                "[Decision Model Guidance]\n"
                "This is auxiliary classification. Do not reveal it; use the customer message and references as authoritative.\n"
                f"{json.dumps(decision, ensure_ascii=False)}"
            )
            run_context["provider_request"] = replace(request, prompt_template=guidance)
        provider_response = run_context["provider"].generate(run_context["provider_request"])

        return self.build_run_response(
            run_context=run_context,
            provider_response=provider_response,
            draft=provider_response.draft,
        )

    def run_decision(self, run_context: dict[str, Any]) -> tuple[dict[str, Any] | None, str | None]:
        config = run_context.get("provider_config", {})
        if not isinstance(config, dict) or not config.get("decision_enabled"):
            return None, None
        model = str(config.get("decision_model") or "").strip()
        if not model:
            models = config.get("decision_models")
            if isinstance(models, list) and models:
                model = str(models[0]).strip()
        if not model:
            return None, "decision model is enabled but no decision_model is configured"
        decision_config = dict(config)
        decision_config["model"] = model
        decision_config["decision_enabled"] = False
        decision_config.pop("decision_model", None)
        decision_config.pop("decision_models", None)
        if config.get("decision_base_url"):
            decision_config["base_url"] = config.get("decision_base_url")
        if config.get("decision_api_key"):
            decision_config["api_key"] = config.get("decision_api_key")
        if config.get("decision_provider_type"):
            decision_config["type"] = config.get("decision_provider_type")
        request = run_context["provider_request"]
        decision_request = replace(request, prompt_template=(
            "Classify this customer-support conversation. Return only strict JSON with "
            "need_skill (boolean), intent (one of 售前|售后|客服|引流|进群引导|其他), "
            "skill_tags (string array), customer_stage (string), "
            "risk (low|medium|high), and reason (string)."
        ), metadata={**request.metadata, "task": "decision"})
        try:
            decision_base_url = str(config.get("decision_base_url") or "").strip().rstrip("/")
            if decision_base_url.endswith("/systemone"):
                payload = {
                    "model": model,
                    "state": f"客户消息：{request.customer_message}\n最近上下文：{request.recent_messages}",
                    "questions": {
                        "need_skill": {"type": "noul", "instructions": "是否需要查询 Skill 和 reference 知识后再回答？"},
                        "intent": {"type": "choice", "instructions": "判断客户当前最主要业务意图，用于筛选话术 Skill", "criteria": {"售前": "产品、价格、功能咨询", "售后": "故障、退款、账号或使用问题", "客服": "一般咨询、订单跟进、服务沟通", "引流": "活动、社群、联系方式", "进群引导": "邀请加入群组或社群", "其他": "无法归入以上类别"}},
                        "skill_tags": {"type": "multi_choice", "instructions": "给出需要检索的 Skill 分类标签，只能从售前、售后、客服、引流、进群引导中选择；无需查询时返回空数组", "criteria": {"售前": "产品和购买咨询", "售后": "售后问题处理", "客服": "一般客服话术", "引流": "推广及线索引导", "进群引导": "邀请入群话术"}},
                        "risk": {"type": "choice", "instructions": "判断客户风险等级", "criteria": {"低": "没有明显风险", "中": "存在投诉或流失风险", "高": "涉及强烈投诉、资金或安全风险"}},
                    },
                }
                req = urllib_request.Request(decision_base_url, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), method="POST", headers={"Content-Type": "application/json", "Authorization": f"Bearer {config.get('decision_api_key') or config.get('api_key') or ''}"})
                with urllib_request.urlopen(req, timeout=60) as resp:
                    decoded = json.loads(resp.read().decode("utf-8"))
                parsed = decoded if isinstance(decoded, dict) else {"raw": decoded}
            else:
                response = build_provider(decision_config).generate(decision_request)
                parsed = parse_json_object_payload(response.draft)
                if not parsed:
                    return {"raw": response.draft, "model": response.model}, "decision model returned non-JSON"
                parsed["model"] = response.model
            parsed["model"] = model
            return normalize_skill_decision(parsed), None
        except Exception as exc:
            return None, str(exc)

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
            "provider_config": provider_config,
            "provider_request": provider_request,
            "recent_auto_replies": normalize_int(payload.get("recent_auto_replies"), default=0),
        }

    def build_run_response(
        self,
        run_context: dict[str, Any],
        provider_response: ProviderResponse,
        draft: str,
    ) -> dict[str, Any]:
        policy_decision = evaluate_reply(
            run_context["rule"],
            run_context["customer_message"],
            draft,
            run_context["recent_auto_replies"],
        )

        references = run_context["provider_request"].knowledge_references
        reference_paths: list[str] = []
        reference_hashes: list[str] = []
        for reference in references:
            path = ""
            for line in str(reference).splitlines():
                if line.startswith("[path:") and line.endswith("]"):
                    path = line[6:-1]
                    break
            reference_paths.append(path)
            reference_hashes.append(hashlib.sha256(str(reference).encode("utf-8")).hexdigest()[:16])

        provider_config = run_context.get("provider_config", {})
        decision_config = provider_config if isinstance(provider_config, dict) else {}
        skill_decision = run_context.get("decision")
        decision_trace: dict[str, Any] = {
            "called": bool(skill_decision is not None or run_context.get("decision_error")),
            "enabled": bool(decision_config.get("decision_enabled")),
            "provider_type": decision_config.get("decision_provider_type") or ("jev" if str(decision_config.get("decision_base_url") or "").rstrip("/").endswith("/systemone") else decision_config.get("type")),
            "model": decision_config.get("decision_model") or ((decision_config.get("decision_models") or [None])[0] if isinstance(decision_config.get("decision_models"), list) else None),
            "decision": skill_decision,
            "error": run_context.get("decision_error"),
        }
        if isinstance(skill_decision, dict):
            decision_trace["need_skill"] = skill_decision.get("need_skill")
            decision_trace["intent"] = skill_decision.get("intent")
            decision_trace["skill_tags"] = skill_decision.get("skill_tags", [])

        response: dict[str, Any] = {
            "run_id": run_context["request_id"],
            "account_id": run_context["account_id"],
            "chat_id": run_context["chat_id"],
            "trigger_message_id": run_context["trigger_message_id"],
            "status": policy_decision.status,
            "draft": draft,
            "block_reasons": policy_decision.block_reasons,
            "provider": {
                "type": provider_response.provider,
                "model": provider_response.model,
                "usage": provider_response.usage,
            },
            "policy": asdict(policy_decision),
            "trace": {
                "generated_at": utc_now().isoformat(),
                "recent_message_count": len(run_context["recent_messages"]),
                "prompt_preview": run_context["provider_request"].prompt_template[:160],
                "decision": run_context.get("decision"),
                "decision_error": run_context.get("decision_error"),
                "decision_model": decision_trace,
                "skill_lookup": run_context["provider_request"].metadata.get("skill_lookup", "not_decided"),
                "skill_intent": run_context["provider_request"].metadata.get("skill_intent"),
                "skill_tags": run_context["provider_request"].metadata.get("skill_tags", []),
                "skill_filter": run_context["provider_request"].metadata.get("skill_filter"),
                "reference_count": len(references),
                "skill": {
                    "bound": bool(run_context["provider_request"].knowledge_summary or references),
                    "summary_present": bool(run_context["provider_request"].knowledge_summary),
                    "reference_count": len(references),
                    "reference_paths": reference_paths,
                    "reference_hashes": reference_hashes,
                },
            },
        }

        if policy_decision.should_dispatch:
            response["dispatch"] = {
                "channel": "session-gateway",
                "account_id": run_context["account_id"],
                "chat_id": run_context["chat_id"],
                "message_text": draft,
            }

        return response

    def prepare_run_stream(self, payload: dict[str, Any]):
        run_context = self.build_run_context(payload)
        decision, decision_error = self.run_decision(run_context)
        run_context = self._apply_skill_decision(run_context, decision, decision_error)
        run_context["decision"] = decision
        run_context["decision_error"] = decision_error
        if decision:
            request = run_context["provider_request"]
            run_context["provider_request"] = replace(
                request,
                prompt_template=(
                    f"{request.prompt_template.strip()}\n\n"
                    "[Decision Model Guidance]\n"
                    "这是辅助分类结果，不要向客户展示。只按客户消息和可用参考资料生成回复。\n"
                    f"{json.dumps(decision, ensure_ascii=False)}"
                ),
            )

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
            "Follow the target language supplied by this request; do not assume Chinese. "
            "Return one strict JSON object and do not add markdown."
        )
        prompt_template = (
            f"{prompt_template}\n\n"
            "[Request Translation Contract]\n"
            f"For this request, the target language is {target_language_name} ({target_language}). "
            "Translate into this target language, even if an earlier generic instruction names another language. "
            "The target language in this request is authoritative. Return exactly one translation, not three alternatives. "
            'Return only this strict JSON object: {"source_language_code":"string",'
            '"source_language_name":"Simplified Chinese language name","translated_text":"string"}.'
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
        try:
            status_card = parse_status_card_payload(provider_response.draft)
        except ProviderError:
            repair_response = provider.generate(
                ProviderRequest(
                    rule_name="status_card_repair",
                    prompt_template=(
                        "You repair status-card output into strict JSON. Return exactly one JSON object "
                        "matching the requested schema, with no markdown or explanation."
                    ),
                    knowledge_summary=None,
                    knowledge_references=[],
                    chat_title=None,
                    customer_message=provider_response.draft,
                    recent_messages=[],
                    metadata={"task": "status_card_repair"},
                )
            )
            try:
                status_card = parse_status_card_payload(repair_response.draft)
            except ProviderError as exc:
                raise ProviderError(
                    "状态分析结果格式异常，系统自动修复后仍无法解析，请检查状态卡提示词或更换模型"
                ) from exc

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


def normalize_skill_decision(value: dict[str, Any]) -> dict[str, Any]:
    raw_need_skill = value.get("need_skill")
    if isinstance(raw_need_skill, str):
        need_skill = raw_need_skill.strip().lower() in {"true", "1", "yes", "y", "需要", "是"}
    else:
        need_skill = bool(raw_need_skill)

    intent = optional_string(value.get("intent")) or "其他"
    raw_tags = value.get("skill_tags")
    tags = raw_tags if isinstance(raw_tags, list) else []
    skill_tags: list[str] = []
    for tag in tags:
        normalized = optional_string(tag)
        if normalized and normalized not in skill_tags:
            skill_tags.append(normalized)
    if intent not in skill_tags and intent != "其他":
        skill_tags.insert(0, intent)

    return {
        "need_skill": need_skill,
        "intent": intent,
        "skill_tags": skill_tags[:8],
        "customer_stage": optional_string(value.get("customer_stage")) or "未知",
        "risk": optional_string(value.get("risk")) or "未知",
        "reason": optional_string(value.get("reason")) or "",
        "model": optional_string(value.get("model")) or "",
    }


def filter_skill_references(references: list[str], tags: Any) -> tuple[list[str], str]:
    normalized_tags = [str(tag).strip().casefold() for tag in tags if str(tag).strip()] if isinstance(tags, list) else []
    if not normalized_tags:
        return references, "no_tags_fallback_all_bound_references"

    tagged = [reference for reference in references if reference.casefold().find("[skill:") >= 0]
    if not tagged:
        return references, "unlabeled_references_fallback_all_bound_references"

    aliases = {
        "售前": {"售前", "pre-sales", "presales", "sales"},
        "售后": {"售后", "after-sales", "aftersales", "support", "customer-service"},
        "客服": {"客服", "customer-service", "customer support", "support"},
        "引流": {"引流", "lead", "lead-generation", "marketing"},
        "进群引导": {"进群引导", "group", "group-onboarding", "community"},
    }
    expanded_tags = set(normalized_tags)
    for tag in normalized_tags:
        expanded_tags.update(aliases.get(tag, set()))

    matched = [
        reference
        for reference in tagged
        if any(tag in reference.casefold() for tag in expanded_tags)
    ]
    if not matched:
        return [], "no_matching_skill_references"
    return matched, "matched_skill_references"


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
        return decoded if isinstance(decoded, dict) else None
    except (TypeError, ValueError):
        pass

    decoder = json.JSONDecoder()
    for index, character in enumerate(cleaned):
        if character != "{":
            continue
        try:
            decoded, _ = decoder.raw_decode(cleaned[index:])
        except ValueError:
            continue
        if isinstance(decoded, dict):
            return decoded
    return None


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
