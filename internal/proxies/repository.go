package proxies

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/storage"
)

type Repository struct {
	db storage.DBTX
}

type transactionStarter interface {
	BeginTx(context.Context, *sql.TxOptions) (*sql.Tx, error)
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("proxy repository requires a database handle")
	}
	return &Repository{db: db}, nil
}

func (r *Repository) Create(ctx context.Context, proxy Proxy) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	const query = `
INSERT INTO local_proxy_endpoints (
    id, user_id, name, scheme, host, port, username, password_ciphertext,
    exit_ip, country, enabled, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`
	_, err = r.db.ExecContext(ctx, query, proxy.ID, userID, proxy.Name, proxy.Scheme, proxy.Host, proxy.Port, proxy.Username, proxy.PasswordCiphertext, proxy.ExitIP, proxy.Country, proxy.Enabled, proxy.ExpiresAt)
	if err != nil {
		return fmt.Errorf("create local proxy %q: %w", proxy.ID, err)
	}
	return nil
}

func (r *Repository) List(ctx context.Context) ([]Proxy, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := r.db.QueryContext(ctx, listQuery+" WHERE user_id = $1 ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, fmt.Errorf("list local proxies: %w", err)
	}
	defer rows.Close()

	items := make([]Proxy, 0)
	for rows.Next() {
		item, scanErr := scanProxy(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate local proxies: %w", err)
	}
	return items, nil
}

func (r *Repository) Get(ctx context.Context, id string) (Proxy, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return Proxy{}, err
	}
	row := r.db.QueryRowContext(ctx, listQuery+" WHERE id = $1 AND user_id = $2", id, userID)
	return scanProxy(row)
}

func (r *Repository) Update(ctx context.Context, proxy Proxy) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	const query = `
UPDATE local_proxy_endpoints
SET name = $3, scheme = $4, host = $5, port = $6, username = $7,
    password_ciphertext = $8, exit_ip = $9, country = $10, enabled = $11,
    expires_at = $12, updated_at = NOW()
WHERE id = $1 AND user_id = $2`
	result, err := r.db.ExecContext(ctx, query, proxy.ID, userID, proxy.Name, proxy.Scheme, proxy.Host, proxy.Port, proxy.Username, proxy.PasswordCiphertext, proxy.ExitIP, proxy.Country, proxy.Enabled, proxy.ExpiresAt)
	if err != nil {
		return fmt.Errorf("update local proxy %q: %w", proxy.ID, err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	starter, ok := r.db.(transactionStarter)
	if !ok {
		return fmt.Errorf("delete local proxy %q: database does not support transactions", id)
	}
	tx, err := starter.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin deleting local proxy %q: %w", id, err)
	}
	rollback := func(deleteErr error) error {
		_ = tx.Rollback()
		return deleteErr
	}

	// Removing a proxy is an explicit user action. Clear only this user's
	// account bindings in the same transaction before deleting the endpoint.
	if _, err := tx.ExecContext(ctx, `DELETE FROM local_account_proxy_bindings WHERE proxy_id = $1 AND user_id = $2`, id, userID); err != nil {
		return rollback(fmt.Errorf("clear bindings for local proxy %q: %w", id, err))
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM local_proxy_endpoints WHERE id = $1 AND user_id = $2`, id, userID)
	if err != nil {
		return rollback(fmt.Errorf("delete local proxy %q: %w", id, err))
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return rollback(sql.ErrNoRows)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit deleting local proxy %q: %w", id, err)
	}
	return nil
}

func (r *Repository) GetBinding(ctx context.Context, accountID string) (Proxy, error) {
	userID, err := currentUserID(ctx)
	if err != nil {
		return Proxy{}, err
	}
	return scanProxy(r.db.QueryRowContext(ctx, listQuery+`
JOIN local_account_proxy_bindings b ON b.proxy_id = local_proxy_endpoints.id
WHERE b.account_id = $1 AND b.user_id = $2 AND local_proxy_endpoints.user_id = $2`, accountID, userID))
}

func (r *Repository) SetBinding(ctx context.Context, accountID, proxyID string) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	result, err := r.db.ExecContext(ctx, `
INSERT INTO local_account_proxy_bindings (account_id, user_id, proxy_id)
SELECT a.id, $2, p.id
FROM accounts a
JOIN local_proxy_endpoints p ON p.id = $3 AND p.user_id = $2
WHERE a.id = $1 AND a.user_id = $2
ON CONFLICT (account_id) DO UPDATE SET user_id = EXCLUDED.user_id, proxy_id = EXCLUDED.proxy_id, updated_at = NOW()`, accountID, userID, proxyID)
	if err != nil {
		return fmt.Errorf("bind proxy %q to account %q: %w", proxyID, accountID, err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return fmt.Errorf("account or proxy is not available: %w", sql.ErrNoRows)
	}
	return nil
}

func (r *Repository) ClearBinding(ctx context.Context, accountID string) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `DELETE FROM local_account_proxy_bindings WHERE account_id = $1 AND user_id = $2`, accountID, userID)
	if err != nil {
		return fmt.Errorf("clear proxy binding for account %q: %w", accountID, err)
	}
	return nil
}

func (r *Repository) ResolveBinding(ctx context.Context, accountID string) (Proxy, error) {
	return scanProxy(r.db.QueryRowContext(ctx, listQuery+`
JOIN local_account_proxy_bindings b ON b.proxy_id = local_proxy_endpoints.id
JOIN accounts a ON a.id = b.account_id
WHERE b.account_id = $1 AND a.user_id = b.user_id AND local_proxy_endpoints.user_id = b.user_id`, accountID))
}

func (r *Repository) UpdateCheck(ctx context.Context, id, exitIP, checkError string) error {
	userID, err := currentUserID(ctx)
	if err != nil {
		return err
	}
	var errorValue *string
	if strings.TrimSpace(checkError) != "" {
		value := strings.TrimSpace(checkError)
		errorValue = &value
	}
	var ipValue *string
	if strings.TrimSpace(exitIP) != "" {
		value := strings.TrimSpace(exitIP)
		ipValue = &value
	}
	_, err = r.db.ExecContext(ctx, `UPDATE local_proxy_endpoints SET exit_ip = COALESCE($3, exit_ip), last_checked_at = NOW(), last_check_error = $4, updated_at = NOW() WHERE id = $1 AND user_id = $2`, id, userID, ipValue, errorValue)
	return err
}

const listQuery = `
SELECT local_proxy_endpoints.id,
       local_proxy_endpoints.user_id,
       local_proxy_endpoints.name,
       local_proxy_endpoints.scheme,
       local_proxy_endpoints.host,
       local_proxy_endpoints.port,
       local_proxy_endpoints.username,
       local_proxy_endpoints.password_ciphertext,
       local_proxy_endpoints.exit_ip,
       local_proxy_endpoints.country,
       local_proxy_endpoints.enabled,
       local_proxy_endpoints.expires_at,
       local_proxy_endpoints.last_checked_at,
       local_proxy_endpoints.last_check_error,
       local_proxy_endpoints.created_at,
       local_proxy_endpoints.updated_at
FROM local_proxy_endpoints`

type rowScanner interface {
	Scan(dest ...any) error
}

func scanProxy(row rowScanner) (Proxy, error) {
	var item Proxy
	var exitIP, country, lastError sql.NullString
	var expiresAt, checkedAt sql.NullTime
	if err := row.Scan(&item.ID, &item.UserID, &item.Name, &item.Scheme, &item.Host, &item.Port, &item.Username, &item.PasswordCiphertext, &exitIP, &country, &item.Enabled, &expiresAt, &checkedAt, &lastError, &item.CreatedAt, &item.UpdatedAt); err != nil {
		return Proxy{}, err
	}
	item.ExitIP = nullableString(exitIP)
	item.Country = nullableString(country)
	item.ExpiresAt = nullableTime(expiresAt)
	item.LastCheckedAt = nullableTime(checkedAt)
	item.LastCheckError = nullableString(lastError)
	return item, nil
}

func currentUserID(ctx context.Context) (string, error) {
	user, ok := auth.CurrentUser(ctx)
	if !ok || strings.TrimSpace(user.ID) == "" {
		return "", auth.ErrUnauthenticated
	}
	return user.ID, nil
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
