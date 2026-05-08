CREATE TABLE IF NOT EXISTS chat_status_cards (
    chat_id UUID PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    agent_id UUID,
    agent_name TEXT NOT NULL DEFAULT '',
    current_stage TEXT NOT NULL DEFAULT '',
    customer_types JSONB NOT NULL DEFAULT '[]'::jsonb,
    current_risk TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
    next_action TEXT NOT NULL DEFAULT '',
    confidence TEXT NOT NULL DEFAULT '',
    message_count INTEGER NOT NULL DEFAULT 0,
    history_limit INTEGER NOT NULL DEFAULT 0,
    analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_status_cards_account_id_idx
    ON chat_status_cards (account_id);

CREATE INDEX IF NOT EXISTS chat_status_cards_analyzed_at_idx
    ON chat_status_cards (analyzed_at DESC);
