CREATE TABLE IF NOT EXISTS export_jobs (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('chat')),
    format TEXT NOT NULL CHECK (format IN ('json', 'markdown', 'html')),
    include_media BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
    artifact_path TEXT,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS export_jobs_account_id_idx
    ON export_jobs (account_id);

CREATE INDEX IF NOT EXISTS export_jobs_chat_id_idx
    ON export_jobs (chat_id);

CREATE INDEX IF NOT EXISTS export_jobs_status_idx
    ON export_jobs (status);
