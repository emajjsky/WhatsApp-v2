ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '';

ALTER TABLE chats
    ADD COLUMN IF NOT EXISTS note TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS marked_unread BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS chat_labels (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#25d366',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (account_id, name)
);

CREATE INDEX IF NOT EXISTS chat_labels_account_id_idx
    ON chat_labels (account_id, name);

CREATE TABLE IF NOT EXISTS chat_label_assignments (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES chat_labels(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (chat_id, label_id)
);

CREATE INDEX IF NOT EXISTS chat_label_assignments_label_id_idx
    ON chat_label_assignments (label_id, chat_id);

CREATE INDEX IF NOT EXISTS chats_workspace_sort_idx
    ON chats (account_id, pinned DESC, marked_unread DESC, last_message_at DESC NULLS LAST);
