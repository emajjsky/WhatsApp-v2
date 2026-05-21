CREATE TABLE IF NOT EXISTS assistant_usage_logs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ws_account_id TEXT NOT NULL DEFAULT '',
    ws_account_name TEXT NOT NULL DEFAULT '',
    chat_id TEXT NOT NULL DEFAULT '',
    customer_id TEXT NOT NULL DEFAULT '',
    customer_nickname TEXT NOT NULL DEFAULT '',
    latest_message_id TEXT NOT NULL DEFAULT '',
    latest_message_type TEXT NOT NULL DEFAULT '',
    latest_message_text TEXT NOT NULL DEFAULT '',
    latest_message_media_ref TEXT NOT NULL DEFAULT '',
    latest_message_received_at TIMESTAMPTZ,
    trigger_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_id TEXT NOT NULL DEFAULT '',
    agent_name TEXT NOT NULL DEFAULT '',
    adopted_option_index INTEGER,
    adopted_option_content TEXT NOT NULL DEFAULT '',
    final_draft_content TEXT NOT NULL DEFAULT '',
    translated_content TEXT NOT NULL DEFAULT '',
    target_language TEXT NOT NULL DEFAULT '',
    action_type TEXT NOT NULL CHECK (action_type IN ('writeback', 'send')),
    log_date DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_log_date_idx
    ON assistant_usage_logs (log_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_user_date_idx
    ON assistant_usage_logs (user_id, log_date DESC);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_account_date_idx
    ON assistant_usage_logs (ws_account_id, log_date DESC);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_chat_date_idx
    ON assistant_usage_logs (chat_id, log_date DESC);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_agent_date_idx
    ON assistant_usage_logs (agent_id, log_date DESC);

CREATE INDEX IF NOT EXISTS assistant_usage_logs_action_date_idx
    ON assistant_usage_logs (action_type, log_date DESC);
