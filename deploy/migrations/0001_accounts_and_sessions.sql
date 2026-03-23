CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL,
    phone_number TEXT,
    status TEXT NOT NULL CHECK (
        status IN (
            'pending',
            'pairing',
            'connected',
            'reconnecting',
            'disconnected',
            'logged_out',
            'failed'
        )
    ),
    platform_label TEXT,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_phone_number_unique
    ON accounts (phone_number)
    WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS accounts_status_idx
    ON accounts (status);

CREATE TABLE IF NOT EXISTS session_credentials (
    account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    credential_blob BYTEA NOT NULL,
    noise_keys_version INTEGER NOT NULL DEFAULT 1,
    device_id TEXT,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS session_credentials_device_id_idx
    ON session_credentials (device_id);
