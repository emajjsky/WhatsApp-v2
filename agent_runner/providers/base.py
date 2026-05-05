from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from collections.abc import Iterator
from typing import Any, Mapping


class ProviderError(RuntimeError):
    """Raised when a provider cannot build a draft reply."""


@dataclass(frozen=True)
class ProviderRequest:
    rule_name: str
    prompt_template: str
    knowledge_summary: str | None
    knowledge_references: list[str] = field(default_factory=list)
    chat_title: str | None = None
    customer_message: str = ""
    recent_messages: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ProviderResponse:
    provider: str
    model: str
    draft: str
    usage: dict[str, int] = field(default_factory=dict)


class BaseProvider(ABC):
    name: str = "base"
    model: str = "unknown"

    @abstractmethod
    def generate(self, request: ProviderRequest) -> ProviderResponse:
        raise NotImplementedError

    def stream_generate(self, request: ProviderRequest) -> Iterator[str]:
        response = self.generate(request)
        if response.draft:
            yield response.draft


class MockProvider(BaseProvider):
    name = "mock"
    model = "mock-echo-v1"

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        if request.metadata.get("task") == "status_card":
            draft = (
                '{"current_stage":"新线索","customer_types":["新手"],'
                '"current_risk":"低","summary":"本地模拟分析：客户刚开始沟通，信息量有限。",'
                '"evidence":["当前为 mock provider，未调用外部模型"],'
                '"next_action":"继续破冰，确认客户需求后再引导进群。","confidence":"低"}'
            )
            return ProviderResponse(
                provider=self.name,
                model=self.model,
                draft=draft,
                usage={"input_messages": len(request.recent_messages), "output_characters": len(draft)},
            )

        customer_message = request.customer_message.strip() or "您好，已收到您的消息。"
        summary = request.knowledge_summary.strip() if request.knowledge_summary else ""
        references = "；".join(reference.strip() for reference in request.knowledge_references if reference.strip())

        reply_lines = [
            "您好，消息已经收到，我先帮您核对处理。",
        ]

        lowered_message = customer_message.casefold()
        if "发货" in customer_message or "物流" in customer_message or "快递" in customer_message:
            reply_lines.append("关于发货和物流进度，我会先核对订单状态，再给您明确时间。")
        elif "退款" in customer_message or "退货" in customer_message:
            reply_lines.append("退款和退货需要先确认订单状态与售后条件，我这边先帮您查。")
        elif "价格" in customer_message or "优惠" in customer_message:
            reply_lines.append("价格和优惠信息我会先核实当前活动，再给您准确回复。")
        elif "投诉" in customer_message or "差评" in customer_message:
            reply_lines.append("抱歉给您添麻烦了，我先把问题记录下来并尽快处理。")
        elif "你好" in lowered_message or "您好" in customer_message:
            reply_lines.append("您可以直接告诉我订单号、问题点或想确认的事项，我马上帮您继续跟进。")
        else:
            reply_lines.append("请您再给我一点信息，例如订单号、时间点或具体问题，我会尽快处理。")

        if summary:
            reply_lines.append(f"当前规则备注：{summary}")
        if references:
            reply_lines.append(f"处理参考：{references}")

        reply_lines.append("我处理完会第一时间回复您。")

        draft = "\n".join(reply_lines)
        usage = {
            "input_messages": len(request.recent_messages) + 1,
            "output_characters": len(draft),
        }
        return ProviderResponse(provider=self.name, model=self.model, draft=draft, usage=usage)


class StaticProvider(BaseProvider):
    name = "static"
    model = "static-template-v1"

    def __init__(self, response_text: str) -> None:
        response = response_text.strip()
        if not response:
            raise ProviderError("static provider requires a non-empty response")
        self._response = response

    def generate(self, request: ProviderRequest) -> ProviderResponse:
        draft = self._response.format(
            rule_name=request.rule_name,
            customer_message=request.customer_message,
            chat_title=request.chat_title or "未命名会话",
        )
        return ProviderResponse(
            provider=self.name,
            model=self.model,
            draft=draft,
            usage={"output_characters": len(draft)},
        )


def build_provider(config: Mapping[str, Any] | None) -> BaseProvider:
    provider_type = str((config or {}).get("type") or "mock").strip().lower()

    if provider_type == "mock":
        return MockProvider()
    if provider_type == "static":
        response_text = str((config or {}).get("response") or "").strip()
        return StaticProvider(response_text)
    if provider_type in {"openai_compatible", "openaicompatible", "openai-compatible", "openai"}:
        from .openai_compatible import OpenAICompatibleProvider

        return OpenAICompatibleProvider(config)
    if provider_type in {"webhook", "coze", "n8n"}:
        from .webhook import WebhookProvider

        return WebhookProvider(config, provider_type=provider_type)

    raise ProviderError(f"unsupported provider type: {provider_type}")


def available_providers() -> list[dict[str, str]]:
    return [
        {"type": "mock", "description": "Built-in deterministic draft provider for local development"},
        {"type": "static", "description": "Return a fixed templated response supplied in the request"},
        {"type": "openai_compatible", "description": "Call an OpenAI-compatible /v1/chat/completions endpoint"},
        {"type": "coze", "description": "Call a Coze workflow or bot webhook and read a draft from the response"},
        {"type": "n8n", "description": "Call an n8n webhook and read a draft from the response"},
        {"type": "webhook", "description": "Call a custom agent webhook and read a draft from the response"},
    ]
