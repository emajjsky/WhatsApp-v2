ALTER TABLE agent_rules
    ADD COLUMN IF NOT EXISTS purpose TEXT NOT NULL DEFAULT 'reply';

ALTER TABLE agent_rules DROP CONSTRAINT IF EXISTS agent_rules_purpose_check;

ALTER TABLE agent_rules
    ADD CONSTRAINT agent_rules_purpose_check
    CHECK (purpose IN ('reply', 'translation'));

CREATE TABLE IF NOT EXISTS agent_rule_accounts (
    rule_id UUID NOT NULL REFERENCES agent_rules(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (rule_id, account_id)
);

INSERT INTO agent_rule_accounts (rule_id, account_id)
SELECT id, account_id
FROM agent_rules
ON CONFLICT (rule_id, account_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS agent_rule_accounts_account_id_idx
    ON agent_rule_accounts (account_id);

CREATE INDEX IF NOT EXISTS agent_rules_purpose_idx
    ON agent_rules (purpose);
