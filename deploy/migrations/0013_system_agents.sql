CREATE TABLE IF NOT EXISTS system_agents (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('reply', 'translation')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    prompt_template TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS system_agents_purpose_enabled_idx
    ON system_agents (purpose, enabled);

CREATE UNIQUE INDEX IF NOT EXISTS system_agents_purpose_name_unique
    ON system_agents (purpose, LOWER(name));

INSERT INTO system_agents (
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
)
SELECT
    CASE purpose
        WHEN 'reply' THEN '00000000-0000-0000-0000-000000000101'::uuid
        WHEN 'translation' THEN '00000000-0000-0000-0000-000000000102'::uuid
    END,
    CASE purpose
        WHEN 'reply' THEN '默认回复智能体'
        WHEN 'translation' THEN '默认翻译智能体'
    END,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
FROM system_agent_configs
WHERE purpose IN ('reply', 'translation')
ON CONFLICT (id) DO NOTHING;
