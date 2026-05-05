ALTER TABLE system_agents DROP CONSTRAINT IF EXISTS system_agents_purpose_check;

ALTER TABLE system_agents
    ADD CONSTRAINT system_agents_purpose_check
    CHECK (purpose IN ('reply', 'translation', 'status_card'));

ALTER TABLE system_agent_configs DROP CONSTRAINT IF EXISTS system_agent_configs_purpose_check;

ALTER TABLE system_agent_configs
    ADD CONSTRAINT system_agent_configs_purpose_check
    CHECK (purpose IN ('reply', 'translation', 'status_card'));
