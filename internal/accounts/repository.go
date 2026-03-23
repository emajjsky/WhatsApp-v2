package accounts

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"whatsapp-agent-platform/internal/storage"
)

type Account struct {
	ID           string
	DisplayName  string
	PhoneNumber  *string
	Status       string
	PlatformLabel *string
	LastSeenAt   *time.Time
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type Repository struct {
	db storage.DBTX
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("accounts repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) Create(ctx context.Context, account Account) error {
	const query = `
INSERT INTO accounts (
    id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, $6)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		account.ID,
		account.DisplayName,
		account.PhoneNumber,
		account.Status,
		account.PlatformLabel,
		account.LastSeenAt,
	); err != nil {
		return fmt.Errorf("create account %q: %w", account.ID, err)
	}

	return nil
}

func (r *Repository) GetByID(ctx context.Context, id string) (Account, error) {
	const query = `
SELECT
    id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at,
    created_at,
    updated_at
FROM accounts
WHERE id = $1`

	var (
		account       Account
		phoneNumber   sql.NullString
		platformLabel sql.NullString
		lastSeenAt    sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, id).Scan(
		&account.ID,
		&account.DisplayName,
		&phoneNumber,
		&account.Status,
		&platformLabel,
		&lastSeenAt,
		&account.CreatedAt,
		&account.UpdatedAt,
	); err != nil {
		return Account{}, fmt.Errorf("get account %q: %w", id, err)
	}

	account.PhoneNumber = nullableString(phoneNumber)
	account.PlatformLabel = nullableString(platformLabel)
	account.LastSeenAt = nullableTime(lastSeenAt)

	return account, nil
}

func (r *Repository) List(ctx context.Context) ([]Account, error) {
	const query = `
SELECT
    id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at,
    created_at,
    updated_at
FROM accounts
ORDER BY created_at DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	accounts := make([]Account, 0)
	for rows.Next() {
		var (
			account       Account
			phoneNumber   sql.NullString
			platformLabel sql.NullString
			lastSeenAt    sql.NullTime
		)

		if err := rows.Scan(
			&account.ID,
			&account.DisplayName,
			&phoneNumber,
			&account.Status,
			&platformLabel,
			&lastSeenAt,
			&account.CreatedAt,
			&account.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan account row: %w", err)
		}

		account.PhoneNumber = nullableString(phoneNumber)
		account.PlatformLabel = nullableString(platformLabel)
		account.LastSeenAt = nullableTime(lastSeenAt)

		accounts = append(accounts, account)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate account rows: %w", err)
	}

	return accounts, nil
}

func (r *Repository) UpdateStatus(ctx context.Context, id, status string, lastSeenAt *time.Time) error {
	const query = `
UPDATE accounts
SET
    status = $2,
    last_seen_at = $3,
    updated_at = NOW()
WHERE id = $1`

	if _, err := r.db.ExecContext(ctx, query, id, status, lastSeenAt); err != nil {
		return fmt.Errorf("update account %q status: %w", id, err)
	}

	return nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	const query = `DELETE FROM accounts WHERE id = $1`

	if _, err := r.db.ExecContext(ctx, query, id); err != nil {
		return fmt.Errorf("delete account %q: %w", id, err)
	}

	return nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time
	return &result
}
