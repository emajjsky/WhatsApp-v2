ALTER TABLE agent_provider_presets
    ADD COLUMN IF NOT EXISTS decision_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS decision_models JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS default_decision_model TEXT NOT NULL DEFAULT '';
