CREATE TABLE IF NOT EXISTS contacts (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    wa_jid TEXT NOT NULL,
    display_name TEXT,
    push_name TEXT,
    phone_number TEXT,
    profile_photo_url TEXT,
    is_business BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, wa_jid)
);

CREATE INDEX IF NOT EXISTS contacts_account_id_idx
    ON contacts (account_id);

CREATE INDEX IF NOT EXISTS contacts_phone_number_idx
    ON contacts (phone_number);

CREATE TABLE IF NOT EXISTS chats (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    wa_chat_jid TEXT NOT NULL,
    chat_type TEXT NOT NULL CHECK (
        chat_type IN ('direct', 'group', 'broadcast', 'status')
    ),
    title TEXT,
    participant_count INTEGER,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    muted_until TIMESTAMPTZ,
    last_message_id UUID,
    last_message_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, wa_chat_jid)
);

CREATE INDEX IF NOT EXISTS chats_account_id_idx
    ON chats (account_id);

CREATE INDEX IF NOT EXISTS chats_last_message_at_idx
    ON chats (last_message_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    wa_message_id TEXT NOT NULL,
    sender_jid TEXT NOT NULL,
    from_me BOOLEAN NOT NULL DEFAULT FALSE,
    message_type TEXT NOT NULL CHECK (
        message_type IN (
            'text',
            'image',
            'video',
            'audio',
            'document',
            'sticker',
            'reaction',
            'system',
            'location',
            'contact',
            'poll',
            'unknown'
        )
    ),
    text_content TEXT,
    reply_to_wa_message_id TEXT,
    sent_at TIMESTAMPTZ NOT NULL,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, wa_message_id)
);

CREATE INDEX IF NOT EXISTS messages_chat_id_sent_at_idx
    ON messages (chat_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS messages_sender_jid_idx
    ON messages (sender_jid);

CREATE INDEX IF NOT EXISTS messages_type_idx
    ON messages (message_type);

CREATE TABLE IF NOT EXISTS media_assets (
    id UUID PRIMARY KEY,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK (
        media_type IN ('image', 'video', 'audio', 'document', 'sticker', 'thumbnail', 'other')
    ),
    mime_type TEXT,
    file_name TEXT,
    byte_size BIGINT,
    sha256 TEXT,
    storage_key TEXT,
    download_status TEXT NOT NULL CHECK (
        download_status IN ('pending', 'ready', 'failed', 'expired')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS media_assets_message_id_idx
    ON media_assets (message_id);

CREATE INDEX IF NOT EXISTS media_assets_storage_key_idx
    ON media_assets (storage_key);
