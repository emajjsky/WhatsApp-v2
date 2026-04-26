ALTER TABLE agent_rules
    ADD COLUMN IF NOT EXISTS provider_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS agent_rules_provider_type_idx
    ON agent_rules ((provider_config ->> 'type'));
