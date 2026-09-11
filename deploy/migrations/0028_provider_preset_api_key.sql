ALTER TABLE agent_provider_presets
    ADD COLUMN IF NOT EXISTS api_key TEXT NOT NULL DEFAULT '';
