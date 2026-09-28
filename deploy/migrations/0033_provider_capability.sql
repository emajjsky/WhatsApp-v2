ALTER TABLE agent_provider_presets
    ADD COLUMN IF NOT EXISTS capability TEXT NOT NULL DEFAULT 'text';

UPDATE agent_provider_presets
SET capability = CASE
    WHEN asr_enabled THEN 'asr'
    WHEN text_enabled THEN 'text'
    WHEN decision_enabled THEN 'decision'
    ELSE 'text'
END
WHERE capability = 'text';

ALTER TABLE agent_provider_presets
    DROP CONSTRAINT IF EXISTS agent_provider_presets_single_capability_check;

ALTER TABLE agent_provider_presets
    ADD CONSTRAINT agent_provider_presets_capability_check
    CHECK (capability IN ('text', 'decision', 'asr'));
