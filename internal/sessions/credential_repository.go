package sessions

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"whatsapp-agent-platform/internal/storage"
)

type CredentialRecord struct {
	AccountID        string
	CredentialBlob   []byte
	NoiseKeysVersion int
	DeviceID         *string
	LastSyncedAt     time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type CredentialRepository struct {
	db storage.DBTX
}

func NewCredentialRepository(db storage.DBTX) (*CredentialRepository, error) {
	if db == nil {
		return nil, fmt.Errorf("session credential repository requires a database handle")
	}

	return &CredentialRepository{db: db}, nil
}

func (r *CredentialRepository) Upsert(ctx context.Context, record CredentialRecord) error {
	const query = `
INSERT INTO session_credentials (
    account_id,
    credential_blob,
    noise_keys_version,
    device_id,
    last_synced_at
) VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (account_id)
DO UPDATE SET
    credential_blob = EXCLUDED.credential_blob,
    noise_keys_version = EXCLUDED.noise_keys_version,
    device_id = EXCLUDED.device_id,
    last_synced_at = EXCLUDED.last_synced_at,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		record.AccountID,
		record.CredentialBlob,
		record.NoiseKeysVersion,
		record.DeviceID,
		record.LastSyncedAt,
	); err != nil {
		return fmt.Errorf("upsert credential for account %q: %w", record.AccountID, err)
	}

	return nil
}

func (r *CredentialRepository) GetByAccountID(ctx context.Context, accountID string) (CredentialRecord, error) {
	const query = `
SELECT
    account_id,
    credential_blob,
    noise_keys_version,
    device_id,
    last_synced_at,
    created_at,
    updated_at
FROM session_credentials
WHERE account_id = $1`

	var (
		record   CredentialRecord
		deviceID sql.NullString
	)

	if err := r.db.QueryRowContext(ctx, query, accountID).Scan(
		&record.AccountID,
		&record.CredentialBlob,
		&record.NoiseKeysVersion,
		&deviceID,
		&record.LastSyncedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	); err != nil {
		return CredentialRecord{}, fmt.Errorf("get credential for account %q: %w", accountID, err)
	}

	record.DeviceID = nullableString(deviceID)

	return record, nil
}

func (r *CredentialRepository) DeleteByAccountID(ctx context.Context, accountID string) error {
	const query = `DELETE FROM session_credentials WHERE account_id = $1`

	if _, err := r.db.ExecContext(ctx, query, accountID); err != nil {
		return fmt.Errorf("delete credential for account %q: %w", accountID, err)
	}

	return nil
}

func (r *CredentialRepository) UpsertDeviceBinding(ctx context.Context, accountID string, deviceID *string) error {
	const query = `
INSERT INTO session_credentials (
    account_id,
    credential_blob,
    noise_keys_version,
    device_id,
    last_synced_at
) VALUES ($1, $2, 1, $3, $4)
ON CONFLICT (account_id)
DO UPDATE SET
    device_id = EXCLUDED.device_id,
    last_synced_at = EXCLUDED.last_synced_at,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		accountID,
		[]byte("{}"),
		deviceID,
		time.Now().UTC(),
	); err != nil {
		return fmt.Errorf("upsert device binding for account %q: %w", accountID, err)
	}

	return nil
}

func (r *CredentialRepository) GetDeviceIDByAccountID(ctx context.Context, accountID string) (*string, error) {
	const query = `SELECT device_id FROM session_credentials WHERE account_id = $1`

	var deviceID sql.NullString
	if err := r.db.QueryRowContext(ctx, query, accountID).Scan(&deviceID); err != nil {
		return nil, fmt.Errorf("get device binding for account %q: %w", accountID, err)
	}

	return nullableString(deviceID), nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}
