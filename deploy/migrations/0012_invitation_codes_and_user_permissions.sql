CREATE TABLE IF NOT EXISTS invitation_codes (
    id UUID PRIMARY KEY,
    code TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
    max_uses INTEGER NOT NULL CHECK (max_uses > 0),
    used_count INTEGER NOT NULL DEFAULT 0 CHECK (used_count >= 0),
    expires_at TIMESTAMPTZ,
    note TEXT NOT NULL DEFAULT '',
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT invitation_codes_used_not_over_max CHECK (used_count <= max_uses)
);

CREATE UNIQUE INDEX IF NOT EXISTS invitation_codes_code_unique
    ON invitation_codes (LOWER(code));

CREATE INDEX IF NOT EXISTS invitation_codes_status_idx
    ON invitation_codes (status);

CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL CHECK (permission IN ('accounts', 'chats', 'scripts', 'exports')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS user_permissions_permission_idx
    ON user_permissions (permission);

INSERT INTO user_permissions (user_id, permission)
SELECT u.id, p.permission
FROM users u
CROSS JOIN (
    VALUES
        ('accounts'),
        ('chats'),
        ('scripts'),
        ('exports')
) AS p(permission)
WHERE u.role = 'user'
ON CONFLICT (user_id, permission) DO NOTHING;
