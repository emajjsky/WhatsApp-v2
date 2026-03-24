from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True)
class PolicyDecision:
    status: str
    block_reasons: list[str] = field(default_factory=list)
    should_dispatch: bool = False
    reply_mode: str = "suggest"


def evaluate_reply(
    rule: Mapping[str, Any],
    source_message: str,
    draft: str,
    recent_auto_replies: int = 0,
) -> PolicyDecision:
    reply_mode = normalize_reply_mode(rule.get("reply_mode"))
    cooldown_seconds = normalize_int(rule.get("cooldown_seconds"), default=0)
    max_auto_replies = normalize_int(rule.get("max_auto_replies_per_thread"), default=0)
    enabled = bool(rule.get("enabled", False))

    reasons: list[str] = []
    if not draft.strip():
        reasons.append("empty_draft")

    blacklist = rule.get("blacklist_filter") or {}
    blocked_keywords = normalize_string_list(blacklist.get("blocked_keywords"))
    sensitive_topics = normalize_string_list(blacklist.get("sensitive_topics"))

    source_text = source_message.casefold()
    draft_text = draft.casefold()

    for keyword in blocked_keywords:
        if keyword in draft_text:
            reasons.append(f"blocked_keyword:{keyword}")

    for topic in sensitive_topics:
        if topic in source_text or topic in draft_text:
            reasons.append(f"sensitive_topic:{topic}")

    trigger_filter = rule.get("trigger_filter") or {}
    min_message_chars = normalize_int(trigger_filter.get("min_message_chars"), default=0)
    if min_message_chars > 0 and len(source_message.strip()) < min_message_chars:
        reasons.append("source_message_too_short")

    if reply_mode == "auto_send":
        if not enabled:
            reasons.append("auto_send_rule_not_enabled")
        if cooldown_seconds <= 0:
            reasons.append("missing_cooldown_seconds")
        if max_auto_replies <= 0:
            reasons.append("missing_auto_reply_cap")
        if recent_auto_replies >= max_auto_replies > 0:
            reasons.append("thread_auto_reply_cap_reached")

    if reasons:
        return PolicyDecision(
            status="blocked",
            block_reasons=sorted(set(reasons)),
            should_dispatch=False,
            reply_mode=reply_mode,
        )

    if reply_mode == "auto_send":
        return PolicyDecision(
            status="dispatch_ready",
            should_dispatch=True,
            reply_mode=reply_mode,
        )

    return PolicyDecision(
        status="ready_for_review",
        should_dispatch=False,
        reply_mode=reply_mode,
    )


def normalize_reply_mode(value: Any) -> str:
    normalized = str(value or "suggest").strip().lower()
    if normalized == "auto_send":
        return "auto_send"
    return "suggest"


def normalize_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []

    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        normalized = str(item or "").strip().casefold()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)

    return result
