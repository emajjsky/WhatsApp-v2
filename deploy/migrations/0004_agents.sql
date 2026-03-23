CREATE TABLE IF NOT EXISTS agent_rules (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    scope_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    trigger_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    reply_mode TEXT NOT NULL CHECK (reply_mode IN ('suggest', 'auto_send')),
    cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
    max_auto_replies_per_thread INTEGER NOT NULL DEFAULT 0 CHECK (max_auto_replies_per_thread >= 0),
    blacklist_filter JSONB NOT NULL DEFAULT '{}'::jsonb,
    prompt_template TEXT NOT NULL,
    knowledge_binding JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_rules_account_id_idx
    ON agent_rules (account_id);

CREATE INDEX IF NOT EXISTS agent_rules_enabled_idx
    ON agent_rules (enabled);

CREATE INDEX IF NOT EXISTS agent_rules_reply_mode_idx
    ON agent_rules (reply_mode);

CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY,
    rule_id UUID NOT NULL REFERENCES agent_rules(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    trigger_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (
        status IN ('queued', 'generating', 'blocked', 'ready_for_review', 'sent', 'failed')
    ),
    input_context JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_draft TEXT,
    block_reason TEXT,
    sent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_rule_id_idx
    ON agent_runs (rule_id);

CREATE INDEX IF NOT EXISTS agent_runs_account_id_idx
    ON agent_runs (account_id);

CREATE INDEX IF NOT EXISTS agent_runs_chat_id_idx
    ON agent_runs (chat_id);

CREATE INDEX IF NOT EXISTS agent_runs_status_idx
    ON agent_runs (status);

CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx
    ON agent_runs (created_at DESC);
