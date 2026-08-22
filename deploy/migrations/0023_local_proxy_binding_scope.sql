-- Tighten account/proxy binding scope for databases that already applied 0022.
CREATE UNIQUE INDEX IF NOT EXISTS local_proxy_endpoints_id_user_unique
    ON local_proxy_endpoints (id, user_id);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_id_user_unique
    ON accounts (id, user_id);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'local_account_proxy_bindings_account_user_fk'
    ) THEN
        ALTER TABLE local_account_proxy_bindings
            ADD CONSTRAINT local_account_proxy_bindings_account_user_fk
            FOREIGN KEY (account_id, user_id)
            REFERENCES accounts (id, user_id)
            ON DELETE CASCADE
            NOT VALID;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'local_account_proxy_bindings_proxy_user_fk'
    ) THEN
        ALTER TABLE local_account_proxy_bindings
            ADD CONSTRAINT local_account_proxy_bindings_proxy_user_fk
            FOREIGN KEY (proxy_id, user_id)
            REFERENCES local_proxy_endpoints (id, user_id)
            ON DELETE RESTRICT
            NOT VALID;
    END IF;
END $$;
