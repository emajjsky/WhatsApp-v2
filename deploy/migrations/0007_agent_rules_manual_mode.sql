ALTER TABLE agent_rules DROP CONSTRAINT IF EXISTS agent_rules_reply_mode_check;

ALTER TABLE agent_rules
    ADD CONSTRAINT agent_rules_reply_mode_check
    CHECK (reply_mode IN ('manual', 'suggest', 'auto_send'));
