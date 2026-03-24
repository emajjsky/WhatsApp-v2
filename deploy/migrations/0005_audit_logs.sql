CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY,
    actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'agent')),
    actor_id TEXT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'blocked', 'failed')),
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_action_idx
    ON audit_logs (action);

CREATE INDEX IF NOT EXISTS audit_logs_target_idx
    ON audit_logs (target_type, target_id);

CREATE INDEX IF NOT EXISTS audit_logs_outcome_idx
    ON audit_logs (outcome);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
    ON audit_logs (created_at DESC);
