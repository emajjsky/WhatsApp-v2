ALTER TABLE export_jobs
    ADD COLUMN IF NOT EXISTS account_ids_json JSONB,
    ADD COLUMN IF NOT EXISTS chat_ids_json JSONB,
    ADD COLUMN IF NOT EXISTS date_from TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS date_to TIMESTAMPTZ;

UPDATE export_jobs
SET account_ids_json = jsonb_build_array(account_id::text)
WHERE account_ids_json IS NULL;

UPDATE export_jobs
SET chat_ids_json = jsonb_build_array(chat_id::text)
WHERE chat_ids_json IS NULL;

ALTER TABLE export_jobs
    DROP CONSTRAINT IF EXISTS export_jobs_scope_type_check;

ALTER TABLE export_jobs
    ADD CONSTRAINT export_jobs_scope_type_check
        CHECK (scope_type IN ('chat', 'chat_batch'));
