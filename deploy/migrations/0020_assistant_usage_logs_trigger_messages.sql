ALTER TABLE assistant_usage_logs
    ADD COLUMN IF NOT EXISTS trigger_messages JSONB NOT NULL DEFAULT '[]'::jsonb;
