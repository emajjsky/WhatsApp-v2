ALTER TABLE users
    ADD COLUMN IF NOT EXISTS desktop_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices > 0);

CREATE TABLE IF NOT EXISTS user_desktop_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,
    device_name TEXT NOT NULL DEFAULT '',
    app_version TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    last_ip_address TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_desktop_devices_user_device_unique
    ON user_desktop_devices (user_id, device_id);

CREATE INDEX IF NOT EXISTS user_desktop_devices_user_id_idx
    ON user_desktop_devices (user_id);

CREATE INDEX IF NOT EXISTS user_desktop_devices_status_idx
    ON user_desktop_devices (status);

ALTER TABLE auth_sessions
    ADD COLUMN IF NOT EXISTS cloud_token_hash TEXT;

CREATE INDEX IF NOT EXISTS auth_sessions_cloud_token_hash_idx
    ON auth_sessions (cloud_token_hash);
