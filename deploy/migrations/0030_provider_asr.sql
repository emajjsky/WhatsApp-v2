ALTER TABLE agent_provider_presets
    ADD COLUMN IF NOT EXISTS text_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS asr_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS asr_base_url TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS asr_model TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS is_default_asr BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE agent_provider_presets
    ADD CONSTRAINT agent_provider_presets_single_capability_check
    CHECK (text_enabled <> asr_enabled);

CREATE UNIQUE INDEX IF NOT EXISTS agent_provider_presets_single_default_asr_idx
    ON agent_provider_presets (is_default_asr)
    WHERE is_default_asr = TRUE;
