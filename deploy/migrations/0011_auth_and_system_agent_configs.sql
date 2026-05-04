CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
    ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS users_role_idx
    ON users (role);

CREATE INDEX IF NOT EXISTS users_status_idx
    ON users (status);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique
    ON auth_sessions (token_hash);

CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
    ON auth_sessions (user_id);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON auth_sessions (expires_at);

ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS accounts_user_id_idx
    ON accounts (user_id);

ALTER TABLE agent_runs
    ALTER COLUMN rule_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS system_agent_configs (
    purpose TEXT PRIMARY KEY CHECK (purpose IN ('reply', 'translation')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    provider_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    prompt_template TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
