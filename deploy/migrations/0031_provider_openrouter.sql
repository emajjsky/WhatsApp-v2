ALTER TABLE agent_provider_presets
    DROP CONSTRAINT IF EXISTS agent_provider_presets_provider_type_check;

ALTER TABLE agent_provider_presets
    ADD CONSTRAINT agent_provider_presets_provider_type_check
    CHECK (provider_type IN (
        'openai_compatible',
        'openrouter',
        'coze',
        'n8n',
        'webhook'
    ));
