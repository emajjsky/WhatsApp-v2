package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/storage"
	"whatsapp-agent-platform/internal/support/ids"
)

type Repository struct {
	db storage.DBTX
}

type txStarter interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("auth repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) CountUsers(ctx context.Context) (int, error) {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return 0, fmt.Errorf("count users: %w", err)
	}

	return count, nil
}

func (r *Repository) WithTx(ctx context.Context, fn func(*Repository) error) error {
	starter, ok := r.db.(txStarter)
	if !ok {
		return fn(r)
	}

	tx, err := starter.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin auth transaction: %w", err)
	}

	txRepo := &Repository{db: tx}
	if err := fn(txRepo); err != nil {
		_ = tx.Rollback()
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit auth transaction: %w", err)
	}

	return nil
}

func (r *Repository) CreateUser(ctx context.Context, user User) error {
	const query = `
INSERT INTO users (
    id,
    email,
    password_hash,
    display_name,
    role,
    status,
    desktop_enabled,
    license_expires_at,
    max_devices
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	desktop := normalizeCreateDesktopGrant(user.Desktop)

	if _, err := r.db.ExecContext(
		ctx,
		query,
		user.ID,
		normalizeEmail(user.Email),
		user.PasswordHash,
		user.DisplayName,
		user.Role,
		user.Status,
		desktop.Enabled,
		desktop.LicenseExpiresAt,
		desktop.MaxDevices,
	); err != nil {
		return fmt.Errorf("create user %q: %w", user.Email, err)
	}

	return nil
}

func (r *Repository) UpsertMirrorUser(ctx context.Context, input MirrorUserInput) error {
	userID := strings.TrimSpace(input.ID)
	email := normalizeEmail(input.Email)
	if userID == "" {
		return fmt.Errorf("mirror user id is required")
	}
	if email == "" {
		return fmt.Errorf("mirror user email is required")
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = email
	}
	role := normalizeRole(input.Role)
	if role == "" {
		role = RoleUser
	}
	status := normalizeStatus(input.Status)
	if status == "" {
		status = StatusActive
	}
	permissions := normalizePermissions(input.Permissions)
	if role == RoleUser && len(permissions) == 0 {
		permissions = append([]Permission(nil), DefaultUserPermissions...)
	}

	passwordHash := "cloud-auth-mirror"
	const query = `
INSERT INTO users (
    id,
    email,
    password_hash,
    display_name,
    role,
    status
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE
SET
    email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(ctx, query, userID, email, passwordHash, displayName, role, status); err != nil {
		return fmt.Errorf("upsert mirror user %q: %w", email, err)
	}
	if role == RoleUser {
		if err := r.SetUserPermissions(ctx, userID, permissions); err != nil {
			return err
		}
	} else if _, err := r.db.ExecContext(ctx, `DELETE FROM user_permissions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear admin mirror permissions for user %q: %w", userID, err)
	}

	return nil
}

func normalizeCreateDesktopGrant(value DesktopGrant) DesktopGrant {
	desktop := normalizeDesktopGrant(value)
	if !value.Enabled {
		desktop.Enabled = true
	}
	return desktop
}

func (r *Repository) SetUserPermissions(ctx context.Context, userID string, permissions []Permission) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return fmt.Errorf("user id is required")
	}

	if _, err := r.db.ExecContext(ctx, `DELETE FROM user_permissions WHERE user_id = $1`, userID); err != nil {
		return fmt.Errorf("clear permissions for user %q: %w", userID, err)
	}

	for _, permission := range normalizePermissions(permissions) {
		if _, err := r.db.ExecContext(
			ctx,
			`INSERT INTO user_permissions (user_id, permission) VALUES ($1, $2)
             ON CONFLICT (user_id, permission) DO NOTHING`,
			userID,
			permission,
		); err != nil {
			return fmt.Errorf("set permission %q for user %q: %w", permission, userID, err)
		}
	}

	return nil
}

func (r *Repository) GetUserByEmail(ctx context.Context, email string) (User, error) {
	const query = `
SELECT
    id,
    email,
    password_hash,
    display_name,
    role,
    status,
    desktop_enabled,
    license_expires_at,
    max_devices,
    last_login_at,
    created_at,
    updated_at
FROM users
WHERE LOWER(email) = LOWER($1)`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, normalizeEmail(email)))
	if err != nil {
		return User{}, err
	}

	return r.attachPermissions(ctx, user)
}

func (r *Repository) GetUserByID(ctx context.Context, id string) (User, error) {
	const query = `
SELECT
    id,
    email,
    password_hash,
    display_name,
    role,
    status,
    desktop_enabled,
    license_expires_at,
    max_devices,
    last_login_at,
    created_at,
    updated_at
FROM users
WHERE id = $1`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, strings.TrimSpace(id)))
	if err != nil {
		return User{}, err
	}

	return r.attachPermissions(ctx, user)
}

func (r *Repository) FirstAdmin(ctx context.Context) (User, error) {
	const query = `
SELECT
    id,
    email,
    password_hash,
    display_name,
    role,
    status,
    desktop_enabled,
    license_expires_at,
    max_devices,
    last_login_at,
    created_at,
    updated_at
FROM users
WHERE role = 'admin'
ORDER BY created_at ASC, id ASC
LIMIT 1`

	user, err := scanUser(r.db.QueryRowContext(ctx, query))
	if err != nil {
		return User{}, err
	}

	return r.attachPermissions(ctx, user)
}

func (r *Repository) ListUsers(ctx context.Context) ([]User, error) {
	const query = `
SELECT
    id,
    email,
    password_hash,
    display_name,
    role,
    status,
    desktop_enabled,
    license_expires_at,
    max_devices,
    last_login_at,
    created_at,
    updated_at
FROM users
ORDER BY created_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	items := make([]User, 0)
	for rows.Next() {
		user, err := scanUserRows(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, user)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate users: %w", err)
	}

	return r.attachPermissionsToUsers(ctx, items)
}

func (r *Repository) UpdateUser(ctx context.Context, id string, input UpdateUserInput) (User, error) {
	existing, err := r.GetUserByID(ctx, id)
	if err != nil {
		return User{}, err
	}

	if input.DisplayName != nil {
		existing.DisplayName = strings.TrimSpace(*input.DisplayName)
	}
	if input.Role != nil {
		existing.Role = normalizeRole(*input.Role)
	}
	if input.Status != nil {
		existing.Status = normalizeStatus(*input.Status)
	}
	if input.Permissions != nil {
		existing.Permissions = normalizePermissions(*input.Permissions)
	}
	if input.Desktop != nil {
		existing.Desktop = normalizeDesktopGrant(*input.Desktop)
	}

	const query = `
UPDATE users
SET
    display_name = $2,
    role = $3,
    status = $4,
    desktop_enabled = $5,
    license_expires_at = $6,
    max_devices = $7,
    updated_at = NOW()
WHERE id = $1`

	desktop := normalizeDesktopGrant(existing.Desktop)
	result, err := r.db.ExecContext(
		ctx,
		query,
		existing.ID,
		existing.DisplayName,
		existing.Role,
		existing.Status,
		desktop.Enabled,
		desktop.LicenseExpiresAt,
		desktop.MaxDevices,
	)
	if err != nil {
		return User{}, fmt.Errorf("update user %q: %w", id, err)
	}
	if err := ensureAffected(result, id); err != nil {
		return User{}, err
	}

	updated, err := r.GetUserByID(ctx, id)
	if err != nil {
		return User{}, err
	}
	if input.Permissions != nil || updated.Role == RoleUser {
		if err := r.SetUserPermissions(ctx, updated.ID, existing.Permissions); err != nil {
			return User{}, err
		}
	}

	return r.GetUserByID(ctx, id)
}

func (r *Repository) UpdatePassword(ctx context.Context, id string, passwordHash string) error {
	const query = `
UPDATE users
SET
    password_hash = $2,
    updated_at = NOW()
WHERE id = $1`

	result, err := r.db.ExecContext(ctx, query, strings.TrimSpace(id), passwordHash)
	if err != nil {
		return fmt.Errorf("update user %q password: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) MarkLogin(ctx context.Context, id string, at time.Time) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET last_login_at = $2, updated_at = NOW() WHERE id = $1`, id, at)
	if err != nil {
		return fmt.Errorf("mark user %q login: %w", id, err)
	}

	return nil
}

func (r *Repository) CreateSession(ctx context.Context, session Session) error {
	const query = `
INSERT INTO auth_sessions (
    id,
    user_id,
    token_hash,
    cloud_token_hash,
    user_agent,
    ip_address,
    expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		session.ID,
		session.UserID,
		session.TokenHash,
		session.CloudTokenHash,
		session.UserAgent,
		session.IPAddress,
		session.ExpiresAt,
	); err != nil {
		return fmt.Errorf("create session for user %q: %w", session.UserID, err)
	}

	return nil
}

func (r *Repository) CloudTokenHashBySessionTokenHash(ctx context.Context, tokenHash string, now time.Time) (string, error) {
	const query = `
SELECT COALESCE(cloud_token_hash, '')
FROM auth_sessions
WHERE token_hash = $1
  AND expires_at > $2`

	var cloudTokenHash string
	if err := r.db.QueryRowContext(ctx, query, strings.TrimSpace(tokenHash), now).Scan(&cloudTokenHash); err != nil {
		return "", err
	}

	return strings.TrimSpace(cloudTokenHash), nil
}

func (r *Repository) UserBySessionTokenHash(ctx context.Context, tokenHash string, now time.Time) (User, error) {
	const query = `
SELECT
    u.id,
    u.email,
    u.password_hash,
    u.display_name,
    u.role,
    u.status,
    u.desktop_enabled,
    u.license_expires_at,
    u.max_devices,
    u.last_login_at,
    u.created_at,
    u.updated_at
FROM auth_sessions s
JOIN users u ON u.id = s.user_id
WHERE s.token_hash = $1
  AND s.expires_at > $2`

	user, err := scanUser(r.db.QueryRowContext(ctx, query, tokenHash, now))
	if err != nil {
		return User{}, err
	}

	_, _ = r.db.ExecContext(ctx, `UPDATE auth_sessions SET last_seen_at = NOW() WHERE token_hash = $1`, tokenHash)
	return r.attachPermissions(ctx, user)
}

func (r *Repository) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE token_hash = $1`, strings.TrimSpace(tokenHash))
	if err != nil {
		return fmt.Errorf("delete auth session: %w", err)
	}

	return nil
}

func (r *Repository) DeleteExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at <= $1`, now)
	if err != nil {
		return fmt.Errorf("delete expired sessions: %w", err)
	}

	return nil
}

func (r *Repository) UpsertDesktopDevice(ctx context.Context, user User, input DesktopClientInput, ipAddress string, now time.Time) (DesktopDevice, error) {
	userID := strings.TrimSpace(user.ID)
	deviceID := normalizeDeviceID(input.DeviceID)
	if userID == "" {
		return DesktopDevice{}, fmt.Errorf("user id is required")
	}
	if deviceID == "" {
		return DesktopDevice{}, fmt.Errorf("device id is required")
	}

	var existingID string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id FROM user_desktop_devices WHERE user_id = $1 AND device_id = $2`,
		userID,
		deviceID,
	).Scan(&existingID)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return DesktopDevice{}, fmt.Errorf("lookup desktop device: %w", err)
	}

	if existingID == "" {
		activeCount, err := r.CountActiveDesktopDevices(ctx, userID)
		if err != nil {
			return DesktopDevice{}, err
		}
		desktop := normalizeDesktopGrant(user.Desktop)
		if activeCount >= desktop.MaxDevices {
			return DesktopDevice{}, ErrDesktopDeviceLimitReached
		}
		existingID = ids.NewUUID()
	}

	const query = `
INSERT INTO user_desktop_devices (
    id,
    user_id,
    device_id,
    device_name,
    app_version,
    status,
    last_ip_address,
    last_seen_at
) VALUES ($1, $2, $3, $4, $5, 'active', $6, $7)
ON CONFLICT (user_id, device_id) DO UPDATE
SET
    device_name = EXCLUDED.device_name,
    app_version = EXCLUDED.app_version,
    last_ip_address = EXCLUDED.last_ip_address,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		existingID,
		userID,
		deviceID,
		strings.TrimSpace(input.DeviceName),
		strings.TrimSpace(input.AppVersion),
		optionalString(strings.TrimSpace(ipAddress)),
		now,
	); err != nil {
		return DesktopDevice{}, fmt.Errorf("upsert desktop device: %w", err)
	}

	return r.GetDesktopDevice(ctx, userID, deviceID)
}

func (r *Repository) GetDesktopDevice(ctx context.Context, userID string, deviceID string) (DesktopDevice, error) {
	const query = `
SELECT
    id,
    user_id,
    device_id,
    device_name,
    app_version,
    status,
    last_ip_address,
    last_seen_at,
    created_at,
    updated_at
FROM user_desktop_devices
WHERE user_id = $1 AND device_id = $2`

	return scanDesktopDevice(r.db.QueryRowContext(ctx, query, strings.TrimSpace(userID), normalizeDeviceID(deviceID)))
}

func (r *Repository) ListDesktopDevices(ctx context.Context, userID string) ([]DesktopDevice, error) {
	const query = `
SELECT
    id,
    user_id,
    device_id,
    device_name,
    app_version,
    status,
    last_ip_address,
    last_seen_at,
    created_at,
    updated_at
FROM user_desktop_devices
WHERE user_id = $1
ORDER BY last_seen_at DESC, created_at DESC`

	rows, err := r.db.QueryContext(ctx, query, strings.TrimSpace(userID))
	if err != nil {
		return nil, fmt.Errorf("list desktop devices: %w", err)
	}
	defer rows.Close()

	items := make([]DesktopDevice, 0)
	for rows.Next() {
		item, err := scanDesktopDeviceRows(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate desktop devices: %w", err)
	}

	return items, nil
}

func (r *Repository) CountActiveDesktopDevices(ctx context.Context, userID string) (int, error) {
	var count int
	if err := r.db.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM user_desktop_devices WHERE user_id = $1 AND status = 'active'`,
		strings.TrimSpace(userID),
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count desktop devices: %w", err)
	}

	return count, nil
}

func (r *Repository) UpdateDesktopDevice(ctx context.Context, userID string, deviceID string, input UpdateDesktopDeviceInput) (DesktopDevice, error) {
	existing, err := r.GetDesktopDevice(ctx, userID, deviceID)
	if err != nil {
		return DesktopDevice{}, err
	}

	if input.Status != nil {
		status := normalizeDesktopDeviceStatus(*input.Status)
		if status == "" {
			return DesktopDevice{}, fmt.Errorf("unsupported desktop device status %q", *input.Status)
		}
		existing.Status = status
	}

	result, err := r.db.ExecContext(
		ctx,
		`UPDATE user_desktop_devices SET status = $3, updated_at = NOW() WHERE user_id = $1 AND device_id = $2`,
		existing.UserID,
		existing.DeviceID,
		existing.Status,
	)
	if err != nil {
		return DesktopDevice{}, fmt.Errorf("update desktop device: %w", err)
	}
	if err := ensureAffected(result, existing.DeviceID); err != nil {
		return DesktopDevice{}, err
	}

	return r.GetDesktopDevice(ctx, existing.UserID, existing.DeviceID)
}

func (r *Repository) AssignOrphanAccounts(ctx context.Context, userID string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE accounts SET user_id = $1, updated_at = NOW() WHERE user_id IS NULL`, strings.TrimSpace(userID))
	if err != nil {
		return fmt.Errorf("assign orphan accounts: %w", err)
	}

	return nil
}

func (r *Repository) ListInvitationCodes(ctx context.Context) ([]InvitationCode, error) {
	const query = `
SELECT
    id,
    code,
    status,
    max_uses,
    used_count,
    expires_at,
    note,
    created_by,
    last_used_at,
    created_at,
    updated_at
FROM invitation_codes
ORDER BY created_at DESC, id DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list invitation codes: %w", err)
	}
	defer rows.Close()

	items := make([]InvitationCode, 0)
	for rows.Next() {
		item, err := scanInvitationCodeRows(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate invitation codes: %w", err)
	}

	return items, nil
}

func (r *Repository) GetInvitationCodeByID(ctx context.Context, id string) (InvitationCode, error) {
	const query = `
SELECT
    id,
    code,
    status,
    max_uses,
    used_count,
    expires_at,
    note,
    created_by,
    last_used_at,
    created_at,
    updated_at
FROM invitation_codes
WHERE id = $1`

	return scanInvitationCode(r.db.QueryRowContext(ctx, query, strings.TrimSpace(id)))
}

func (r *Repository) GetInvitationCodeByCode(ctx context.Context, code string) (InvitationCode, error) {
	const query = `
SELECT
    id,
    code,
    status,
    max_uses,
    used_count,
    expires_at,
    note,
    created_by,
    last_used_at,
    created_at,
    updated_at
FROM invitation_codes
WHERE LOWER(code) = LOWER($1)`

	return scanInvitationCode(r.db.QueryRowContext(ctx, query, normalizeInviteCode(code)))
}

func (r *Repository) CreateInvitationCode(ctx context.Context, item InvitationCode) error {
	const query = `
INSERT INTO invitation_codes (
    id,
    code,
    status,
    max_uses,
    expires_at,
    note,
    created_by
) VALUES ($1, $2, $3, $4, $5, $6, $7)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		item.ID,
		normalizeInviteCode(item.Code),
		item.Status,
		item.MaxUses,
		item.ExpiresAt,
		item.Note,
		item.CreatedBy,
	); err != nil {
		return fmt.Errorf("create invitation code %q: %w", item.Code, err)
	}

	return nil
}

func (r *Repository) UpdateInvitationCode(ctx context.Context, id string, input UpdateInvitationInput) (InvitationCode, error) {
	existing, err := r.GetInvitationCodeByID(ctx, id)
	if err != nil {
		return InvitationCode{}, err
	}

	if input.Status != nil {
		existing.Status = normalizeInvitationStatus(*input.Status)
	}
	if input.MaxUses != nil {
		existing.MaxUses = *input.MaxUses
	}
	if input.ExpiresAt != nil {
		existing.ExpiresAt = input.ExpiresAt
	}
	if input.Note != nil {
		existing.Note = strings.TrimSpace(*input.Note)
	}

	const query = `
UPDATE invitation_codes
SET
    status = $2,
    max_uses = $3,
    expires_at = $4,
    note = $5,
    updated_at = NOW()
WHERE id = $1`

	result, err := r.db.ExecContext(
		ctx,
		query,
		existing.ID,
		existing.Status,
		existing.MaxUses,
		existing.ExpiresAt,
		existing.Note,
	)
	if err != nil {
		return InvitationCode{}, fmt.Errorf("update invitation code %q: %w", id, err)
	}
	if err := ensureAffected(result, id); err != nil {
		return InvitationCode{}, err
	}

	return r.GetInvitationCodeByID(ctx, id)
}

func (r *Repository) ConsumeInvitationCode(ctx context.Context, code string, now time.Time) error {
	const query = `
UPDATE invitation_codes
SET
    used_count = used_count + 1,
    last_used_at = $2,
    updated_at = NOW()
WHERE LOWER(code) = LOWER($1)
  AND status = 'active'
  AND used_count < max_uses
  AND (expires_at IS NULL OR expires_at > $2)`

	result, err := r.db.ExecContext(ctx, query, normalizeInviteCode(code), now)
	if err != nil {
		return fmt.Errorf("consume invitation code: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read invitation consume rows affected: %w", err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func (r *Repository) attachPermissions(ctx context.Context, user User) (User, error) {
	permissions, err := r.ListUserPermissions(ctx, user.ID)
	if err != nil {
		return User{}, err
	}
	user.Permissions = permissions
	return user, nil
}

func (r *Repository) attachPermissionsToUsers(ctx context.Context, users []User) ([]User, error) {
	for i := range users {
		permissions, err := r.ListUserPermissions(ctx, users[i].ID)
		if err != nil {
			return nil, err
		}
		users[i].Permissions = permissions
	}

	return users, nil
}

func (r *Repository) ListUserPermissions(ctx context.Context, userID string) ([]Permission, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT permission FROM user_permissions WHERE user_id = $1 ORDER BY permission ASC`,
		strings.TrimSpace(userID),
	)
	if err != nil {
		return nil, fmt.Errorf("list permissions for user %q: %w", userID, err)
	}
	defer rows.Close()

	items := make([]Permission, 0)
	for rows.Next() {
		var permission Permission
		if err := rows.Scan(&permission); err != nil {
			return nil, fmt.Errorf("scan permission row: %w", err)
		}
		normalized := normalizePermission(permission)
		if normalized != "" {
			items = append(items, normalized)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate permissions for user %q: %w", userID, err)
	}

	return items, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanUser(row rowScanner) (User, error) {
	var (
		user             User
		lastLoginAt      sql.NullTime
		licenseExpiresAt sql.NullTime
	)

	if err := row.Scan(
		&user.ID,
		&user.Email,
		&user.PasswordHash,
		&user.DisplayName,
		&user.Role,
		&user.Status,
		&user.Desktop.Enabled,
		&licenseExpiresAt,
		&user.Desktop.MaxDevices,
		&lastLoginAt,
		&user.CreatedAt,
		&user.UpdatedAt,
	); err != nil {
		return User{}, err
	}

	if lastLoginAt.Valid {
		user.LastLoginAt = &lastLoginAt.Time
	}
	if licenseExpiresAt.Valid {
		user.Desktop.LicenseExpiresAt = &licenseExpiresAt.Time
	}
	user.Desktop = normalizeDesktopGrant(user.Desktop)

	return user, nil
}

func scanUserRows(rows *sql.Rows) (User, error) {
	user, err := scanUser(rows)
	if err != nil {
		return User{}, fmt.Errorf("scan user row: %w", err)
	}

	return user, nil
}

func scanInvitationCode(row rowScanner) (InvitationCode, error) {
	var (
		item       InvitationCode
		expiresAt  sql.NullTime
		createdBy  sql.NullString
		lastUsedAt sql.NullTime
	)

	if err := row.Scan(
		&item.ID,
		&item.Code,
		&item.Status,
		&item.MaxUses,
		&item.UsedCount,
		&expiresAt,
		&item.Note,
		&createdBy,
		&lastUsedAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return InvitationCode{}, err
	}

	if expiresAt.Valid {
		item.ExpiresAt = &expiresAt.Time
	}
	if createdBy.Valid {
		item.CreatedBy = &createdBy.String
	}
	if lastUsedAt.Valid {
		item.LastUsedAt = &lastUsedAt.Time
	}

	return item, nil
}

func scanInvitationCodeRows(rows *sql.Rows) (InvitationCode, error) {
	item, err := scanInvitationCode(rows)
	if err != nil {
		return InvitationCode{}, fmt.Errorf("scan invitation code row: %w", err)
	}

	return item, nil
}

func scanDesktopDevice(row rowScanner) (DesktopDevice, error) {
	var (
		item          DesktopDevice
		lastIPAddress sql.NullString
	)
	if err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.DeviceID,
		&item.DeviceName,
		&item.AppVersion,
		&item.Status,
		&lastIPAddress,
		&item.LastSeenAt,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return DesktopDevice{}, err
	}
	if lastIPAddress.Valid {
		item.LastIPAddress = &lastIPAddress.String
	}

	return item, nil
}

func scanDesktopDeviceRows(rows *sql.Rows) (DesktopDevice, error) {
	item, err := scanDesktopDevice(rows)
	if err != nil {
		return DesktopDevice{}, fmt.Errorf("scan desktop device row: %w", err)
	}

	return item, nil
}

func ensureAffected(result sql.Result, id string) error {
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read rows affected for %q: %w", id, err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
	}

	return nil
}
