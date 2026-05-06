package accounts

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/storage"
)

type Account struct {
	ID            string
	UserID        string
	DisplayName   string
	PhoneNumber   *string
	Status        string
	PlatformLabel *string
	LastSeenAt    *time.Time
	CreatedAt     time.Time
	UpdatedAt     time.Time
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
    user_id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)`

	userID := strings.TrimSpace(account.UserID)
	if userID == "" {
		if currentUser, ok := auth.CurrentUser(ctx); ok {
			userID = currentUser.ID
		}
	}

	if _, err := r.db.ExecContext(
		ctx,
		query,
		account.ID,
		nullableTrimmedString(userID),
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
	const baseQuery = `
SELECT
    id,
    user_id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at,
    created_at,
    updated_at
FROM accounts
WHERE id = $1%s`

	scopeClause, scopeArgs := accountRowScope(ctx, 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	var (
		account       Account
		userID        sql.NullString
		phoneNumber   sql.NullString
		platformLabel sql.NullString
		lastSeenAt    sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&account.ID,
		&userID,
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

	account.UserID = userID.String
	account.PhoneNumber = nullableString(phoneNumber)
	account.PlatformLabel = nullableString(platformLabel)
	account.LastSeenAt = nullableTime(lastSeenAt)

	return account, nil
}

func (r *Repository) List(ctx context.Context) ([]Account, error) {
	const baseQuery = `
SELECT
    id,
    user_id,
    display_name,
    phone_number,
    status,
    platform_label,
    last_seen_at,
    created_at,
    updated_at
FROM accounts
WHERE 1 = 1%s
ORDER BY created_at DESC`

	scopeClause, scopeArgs := accountRowScope(ctx, 1)
	query := fmt.Sprintf(baseQuery, scopeClause)

	rows, err := r.db.QueryContext(ctx, query, scopeArgs...)
	if err != nil {
		return nil, fmt.Errorf("list accounts: %w", err)
	}
	defer rows.Close()

	accounts := make([]Account, 0)
	for rows.Next() {
		var (
			account       Account
			userID        sql.NullString
			phoneNumber   sql.NullString
			platformLabel sql.NullString
			lastSeenAt    sql.NullTime
		)

		if err := rows.Scan(
			&account.ID,
			&userID,
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

		account.UserID = userID.String
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
	const baseQuery = `
UPDATE accounts
SET
    status = $2,
    last_seen_at = $3,
    updated_at = NOW()
WHERE id = $1%s`

	scopeClause, scopeArgs := accountRowScope(ctx, 4)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id, status, lastSeenAt}, scopeArgs...)

	if _, err := r.db.ExecContext(ctx, query, args...); err != nil {
		return fmt.Errorf("update account %q status: %w", id, err)
	}

	return nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	const baseQuery = `DELETE FROM accounts WHERE id = $1%s`
	scopeClause, scopeArgs := accountRowScope(ctx, 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("delete account %q: %w", id, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete account %q: read rows affected: %w", id, err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func accountRowScope(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok {
		return "", nil
	}

	return fmt.Sprintf(" AND user_id = $%d", startIndex), []any{currentUser.ID}
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
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
