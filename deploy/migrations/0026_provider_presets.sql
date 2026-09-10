CREATE TABLE IF NOT EXISTS agent_provider_presets (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL CHECK (provider_type IN ('openai_compatible', 'coze', 'n8n', 'webhook')),
    base_url TEXT NOT NULL DEFAULT '',
    models JSONB NOT NULL DEFAULT '[]'::jsonb,
    default_model TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS agent_provider_presets_name_unique
    ON agent_provider_presets (LOWER(name));

CREATE INDEX IF NOT EXISTS agent_provider_presets_enabled_idx
    ON agent_provider_presets (enabled, name);
