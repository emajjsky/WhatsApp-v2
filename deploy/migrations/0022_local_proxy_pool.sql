CREATE TABLE IF NOT EXISTS local_proxy_endpoints (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    scheme TEXT NOT NULL CHECK (scheme IN ('http', 'https', 'socks5')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT NOT NULL DEFAULT '',
    password_ciphertext BYTEA NOT NULL,
    exit_ip TEXT,
    country TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    last_check_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS local_proxy_endpoints_user_name_unique
    ON local_proxy_endpoints (user_id, LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS local_proxy_endpoints_id_user_unique
    ON local_proxy_endpoints (id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_id_user_unique
    ON accounts (id, user_id);

CREATE INDEX IF NOT EXISTS local_proxy_endpoints_user_idx
    ON local_proxy_endpoints (user_id);

CREATE TABLE IF NOT EXISTS local_account_proxy_bindings (
    account_id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    proxy_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (account_id, user_id) REFERENCES accounts(id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (proxy_id, user_id) REFERENCES local_proxy_endpoints(id, user_id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS local_account_proxy_bindings_user_idx
    ON local_account_proxy_bindings (user_id);

CREATE INDEX IF NOT EXISTS local_account_proxy_bindings_proxy_idx
    ON local_account_proxy_bindings (proxy_id);
