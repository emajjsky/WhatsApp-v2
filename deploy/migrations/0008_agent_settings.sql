CREATE TABLE IF NOT EXISTS agent_settings (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    base_url TEXT NOT NULL,
    api_key TEXT NOT NULL,
    prompt_template TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_settings_provider_idx
    ON agent_settings (provider);
