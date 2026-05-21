ALTER TABLE assistant_usage_logs
    ADD COLUMN IF NOT EXISTS translation_source_content TEXT NOT NULL DEFAULT '';
