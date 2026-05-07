package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"whatsapp-agent-platform/internal/support/ids"
)

var (
	ErrInvalidCredentials    = errors.New("email or password is incorrect")
	ErrRegistrationDisabled  = errors.New("registration is disabled")
	ErrUserDisabled          = errors.New("user is disabled")
	ErrUserNotFound          = errors.New("user not found")
	ErrInvalidSession        = errors.New("invalid session")
	ErrCannotDisableSelf     = errors.New("cannot disable the current administrator")
	ErrCannotDemoteLastAdmin = errors.New("cannot remove the last administrator")
	ErrInvalidInviteCode     = errors.New("invitation code is invalid or exhausted")
)

type ServiceConfig struct {
	CookieName             string
	SessionTTL             time.Duration
	RegistrationEnabled    bool
	BootstrapAdminEmail    string
	BootstrapAdminPassword string
	BootstrapAdminName     string
	SecureCookie           bool
}

type Service struct {
	repository *Repository
	cfg        ServiceConfig
	cloud      *CloudClient
	logger     *slog.Logger
	now        func() time.Time
}

func NewService(repository *Repository, cfg ServiceConfig, logger *slog.Logger) (*Service, error) {
	return NewServiceWithCloud(repository, cfg, nil, logger)
}

func NewServiceWithCloud(repository *Repository, cfg ServiceConfig, cloud *CloudClient, logger *slog.Logger) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("auth service requires a repository")
	}
	if logger == nil {
		logger = slog.Default()
	}
	cfg.CookieName = strings.TrimSpace(cfg.CookieName)
	if cfg.CookieName == "" {
		cfg.CookieName = "wa_session"
	}
	if cfg.SessionTTL <= 0 {
		cfg.SessionTTL = 7 * 24 * time.Hour
	}
	if strings.TrimSpace(cfg.BootstrapAdminEmail) == "" {
		cfg.BootstrapAdminEmail = "admin@example.com"
	}
	if strings.TrimSpace(cfg.BootstrapAdminName) == "" {
		cfg.BootstrapAdminName = "Administrator"
	}
	if strings.TrimSpace(cfg.BootstrapAdminPassword) == "" {
		cfg.BootstrapAdminPassword = "admin123456"
	}

	return &Service{
		repository: repository,
		cfg:        cfg,
		cloud:      cloud,
		logger:     logger.With("component", "auth_service"),
		now:        func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *Service) Bootstrap(ctx context.Context) (User, error) {
	count, err := s.repository.CountUsers(ctx)
	if err != nil {
		return User{}, err
	}

	var admin User
	if count == 0 {
		if s.cloud != nil {
			s.logger.Info("cloud auth enabled; skipping local administrator bootstrap")
			return User{}, nil
		}

		admin, err = s.CreateUser(ctx, CreateUserInput{
			Email:       s.cfg.BootstrapAdminEmail,
			Password:    s.cfg.BootstrapAdminPassword,
			DisplayName: s.cfg.BootstrapAdminName,
			Role:        RoleAdmin,
			Status:      StatusActive,
		})
		if err != nil {
			return User{}, err
		}
		s.logger.Warn("bootstrap administrator created; change the default password before production use", "email", admin.Email)
	} else {
		admin, err = s.repository.FirstAdmin(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				if s.cloud != nil {
					s.logger.Info("cloud auth enabled; local administrator is not required")
					return User{}, nil
				}
				return User{}, fmt.Errorf("no administrator account exists")
			}
			return User{}, err
		}
	}

	if err := s.repository.AssignOrphanAccounts(ctx, admin.ID); err != nil {
		return User{}, err
	}

	return admin, nil
}

func (s *Service) Register(ctx context.Context, input RegisterInput, r *http.Request) (AuthResult, error) {
	if s.cloud != nil {
		response, err := s.cloud.Register(ctx, input)
		if err != nil {
			return AuthResult{}, err
		}
		user, err := s.mirrorCloudUser(ctx, response.User)
		if err != nil {
			return AuthResult{}, err
		}
		return s.createLoginSession(ctx, user, r)
	}

	if !s.cfg.RegistrationEnabled {
		return AuthResult{}, ErrRegistrationDisabled
	}

	inviteCode := normalizeInviteCode(input.InviteCode)
	if inviteCode == "" {
		return AuthResult{}, ErrInvalidInviteCode
	}

	var user User
	if err := s.repository.WithTx(ctx, func(repo *Repository) error {
		if err := repo.ConsumeInvitationCode(ctx, inviteCode, s.now()); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrInvalidInviteCode
			}
			return err
		}

		created, err := s.createUser(ctx, repo, CreateUserInput{
			Email:       input.Email,
			Password:    input.Password,
			DisplayName: input.DisplayName,
			Role:        RoleUser,
			Status:      StatusActive,
			Permissions: DefaultUserPermissions,
		})
		if err != nil {
			return err
		}
		user = created
		return nil
	}); err != nil {
		return AuthResult{}, err
	}

	return s.createLoginSession(ctx, user, r)
}

func (s *Service) Login(ctx context.Context, input LoginInput, r *http.Request) (AuthResult, error) {
	email := normalizeEmail(input.Email)
	password := strings.TrimSpace(input.Password)
	if email == "" || password == "" {
		return AuthResult{}, ErrInvalidCredentials
	}

	if s.cloud != nil {
		response, err := s.cloud.Login(ctx, input)
		if err != nil {
			return AuthResult{}, err
		}
		user, err := s.mirrorCloudUser(ctx, response.User)
		if err != nil {
			return AuthResult{}, err
		}
		return s.createLoginSession(ctx, user, r)
	}

	user, err := s.repository.GetUserByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return AuthResult{}, ErrInvalidCredentials
		}
		return AuthResult{}, err
	}
	if !user.IsActive() {
		return AuthResult{}, ErrUserDisabled
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return AuthResult{}, ErrInvalidCredentials
	}

	return s.createLoginSession(ctx, user, r)
}

func (s *Service) Logout(ctx context.Context, token string) error {
	tokenHash := HashToken(token)
	if tokenHash == "" {
		return nil
	}

	return s.repository.DeleteSession(ctx, tokenHash)
}

func (s *Service) UserFromToken(ctx context.Context, token string) (User, error) {
	tokenHash := HashToken(token)
	if tokenHash == "" {
		return User{}, ErrInvalidSession
	}

	user, err := s.repository.UserBySessionTokenHash(ctx, tokenHash, s.now())
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return User{}, ErrInvalidSession
		}
		return User{}, err
	}
	if !user.IsActive() {
		return User{}, ErrUserDisabled
	}

	return user, nil
}

func (s *Service) ListUsers(ctx context.Context) ([]User, error) {
	if _, err := RequireAdmin(ctx); err != nil {
		return nil, err
	}

	return s.repository.ListUsers(ctx)
}

func (s *Service) CreateUser(ctx context.Context, input CreateUserInput) (User, error) {
	return s.createUser(ctx, s.repository, input)
}

func (s *Service) createUser(ctx context.Context, repository *Repository, input CreateUserInput) (User, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return User{}, fmt.Errorf("email is required")
	}

	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		displayName = email
	}

	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return User{}, err
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
		permissions = DefaultUserPermissions
	}

	user := User{
		ID:           ids.NewUUID(),
		Email:        email,
		PasswordHash: passwordHash,
		DisplayName:  displayName,
		Role:         role,
		Status:       status,
		Permissions:  permissions,
	}

	if err := repository.CreateUser(ctx, user); err != nil {
		return User{}, err
	}
	if role == RoleUser {
		if err := repository.SetUserPermissions(ctx, user.ID, permissions); err != nil {
			return User{}, err
		}
	}

	return repository.GetUserByID(ctx, user.ID)
}

func (s *Service) AdminCreateUser(ctx context.Context, input CreateUserInput) (User, error) {
	if _, err := RequireAdmin(ctx); err != nil {
		return User{}, err
	}

	return s.CreateUser(ctx, input)
}

func (s *Service) UpdateUser(ctx context.Context, id string, input UpdateUserInput) (User, error) {
	current, err := RequireAdmin(ctx)
	if err != nil {
		return User{}, err
	}

	target, err := s.repository.GetUserByID(ctx, strings.TrimSpace(id))
	if err != nil {
		return User{}, mapUserError(id, err)
	}

	if input.Status != nil && target.ID == current.ID && normalizeStatus(*input.Status) == StatusDisabled {
		return User{}, ErrCannotDisableSelf
	}
	if input.Role != nil && target.Role == RoleAdmin && normalizeRole(*input.Role) != RoleAdmin {
		if err := s.ensureAnotherAdmin(ctx, target.ID); err != nil {
			return User{}, err
		}
	}

	if input.DisplayName != nil && strings.TrimSpace(*input.DisplayName) == "" {
		return User{}, fmt.Errorf("display_name must not be empty")
	}
	if input.Role != nil && normalizeRole(*input.Role) == "" {
		return User{}, fmt.Errorf("unsupported role %q", *input.Role)
	}
	if input.Status != nil && normalizeStatus(*input.Status) == "" {
		return User{}, fmt.Errorf("unsupported status %q", *input.Status)
	}

	if input.Permissions != nil {
		permissions := normalizePermissions(*input.Permissions)
		if normalizeRoleOrExisting(input.Role, target.Role) == RoleUser && len(permissions) == 0 {
			return User{}, fmt.Errorf("permissions must not be empty for regular users")
		}
		input.Permissions = &permissions
	}
	if input.Role != nil && normalizeRole(*input.Role) == RoleUser && input.Permissions == nil && len(target.Permissions) == 0 {
		permissions := append([]Permission(nil), DefaultUserPermissions...)
		input.Permissions = &permissions
	}

	return s.repository.UpdateUser(ctx, target.ID, input)
}

func (s *Service) ResetPassword(ctx context.Context, id string, input ResetPasswordInput) error {
	if _, err := RequireAdmin(ctx); err != nil {
		return err
	}

	passwordHash, err := hashPassword(input.Password)
	if err != nil {
		return err
	}

	if err := s.repository.UpdatePassword(ctx, strings.TrimSpace(id), passwordHash); err != nil {
		return mapUserError(id, err)
	}

	return nil
}

func (s *Service) ListInvitationCodes(ctx context.Context) ([]InvitationCode, error) {
	if _, err := RequireAdmin(ctx); err != nil {
		return nil, err
	}

	return s.repository.ListInvitationCodes(ctx)
}

func (s *Service) CreateInvitationCode(ctx context.Context, input CreateInvitationInput) (InvitationCode, error) {
	admin, err := RequireAdmin(ctx)
	if err != nil {
		return InvitationCode{}, err
	}

	code := normalizeInviteCode(input.Code)
	if code == "" {
		code, err = newInvitationCode()
		if err != nil {
			return InvitationCode{}, err
		}
	}
	if len([]rune(code)) < 6 {
		return InvitationCode{}, fmt.Errorf("invitation code must be at least 6 characters")
	}

	maxUses := input.MaxUses
	if maxUses <= 0 {
		maxUses = 1
	}

	item := InvitationCode{
		ID:        ids.NewUUID(),
		Code:      code,
		Status:    InvitationStatusActive,
		MaxUses:   maxUses,
		ExpiresAt: input.ExpiresAt,
		Note:      strings.TrimSpace(input.Note),
		CreatedBy: &admin.ID,
	}
	if err := s.repository.CreateInvitationCode(ctx, item); err != nil {
		return InvitationCode{}, err
	}

	return s.repository.GetInvitationCodeByID(ctx, item.ID)
}

func (s *Service) UpdateInvitationCode(ctx context.Context, id string, input UpdateInvitationInput) (InvitationCode, error) {
	if _, err := RequireAdmin(ctx); err != nil {
		return InvitationCode{}, err
	}

	if input.Status != nil && normalizeInvitationStatus(*input.Status) == "" {
		return InvitationCode{}, fmt.Errorf("unsupported invitation status %q", *input.Status)
	}
	if input.Status != nil {
		normalized := normalizeInvitationStatus(*input.Status)
		input.Status = &normalized
	}
	if input.MaxUses != nil && *input.MaxUses <= 0 {
		return InvitationCode{}, fmt.Errorf("max_uses must be greater than zero")
	}

	existing, err := s.repository.GetInvitationCodeByID(ctx, strings.TrimSpace(id))
	if err != nil {
		return InvitationCode{}, mapUserError(id, err)
	}
	if input.MaxUses != nil && *input.MaxUses < existing.UsedCount {
		return InvitationCode{}, fmt.Errorf("max_uses cannot be lower than used_count")
	}

	return s.repository.UpdateInvitationCode(ctx, existing.ID, input)
}

func (s *Service) Config() ServiceConfig {
	return s.cfg
}

func (s *Service) mirrorCloudUser(ctx context.Context, cloudUser User) (User, error) {
	role := normalizeRole(cloudUser.Role)
	if role == "" {
		role = RoleUser
	}
	status := normalizeStatus(cloudUser.Status)
	if status == "" {
		status = StatusActive
	}
	permissions := normalizePermissions(cloudUser.Permissions)
	if role == RoleUser && len(permissions) == 0 {
		permissions = append([]Permission(nil), DefaultUserPermissions...)
	}

	input := MirrorUserInput{
		ID:          strings.TrimSpace(cloudUser.ID),
		Email:       normalizeEmail(cloudUser.Email),
		DisplayName: strings.TrimSpace(cloudUser.DisplayName),
		Role:        role,
		Status:      status,
		Permissions: permissions,
	}
	if input.ID == "" {
		input.ID = ids.NewUUID()
	}
	if input.Email == "" {
		return User{}, fmt.Errorf("cloud user email is required")
	}
	if input.DisplayName == "" {
		input.DisplayName = input.Email
	}

	if err := s.repository.UpsertMirrorUser(ctx, input); err != nil {
		return User{}, err
	}

	return s.repository.GetUserByID(ctx, input.ID)
}

func (s *Service) createLoginSession(ctx context.Context, user User, r *http.Request) (AuthResult, error) {
	token, err := newSessionToken()
	if err != nil {
		return AuthResult{}, err
	}

	expiresAt := s.now().Add(s.cfg.SessionTTL)
	session := Session{
		ID:        ids.NewUUID(),
		UserID:    user.ID,
		TokenHash: HashToken(token),
		UserAgent: optionalString(requestUserAgent(r)),
		IPAddress: optionalString(requestIP(r)),
		ExpiresAt: expiresAt,
	}

	if err := s.repository.CreateSession(ctx, session); err != nil {
		return AuthResult{}, err
	}
	if err := s.repository.MarkLogin(ctx, user.ID, s.now()); err != nil {
		s.logger.Warn("failed to mark user login", "user_id", user.ID, "error", err)
	}

	user.LastLoginAt = timePointer(s.now())
	return AuthResult{User: user, Token: token, ExpiresAt: expiresAt}, nil
}

func (s *Service) ensureAnotherAdmin(ctx context.Context, targetID string) error {
	users, err := s.repository.ListUsers(ctx)
	if err != nil {
		return err
	}

	for _, user := range users {
		if user.ID != targetID && user.Role == RoleAdmin && user.Status == StatusActive {
			return nil
		}
	}

	return ErrCannotDemoteLastAdmin
}

func HashToken(token string) string {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return ""
	}

	sum := sha256.Sum256([]byte(trimmed))
	return hex.EncodeToString(sum[:])
}

func hashPassword(password string) (string, error) {
	if len([]rune(password)) < 8 {
		return "", fmt.Errorf("password must be at least 8 characters")
	}

	body, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}

	return string(body), nil
}

func newSessionToken() (string, error) {
	body := make([]byte, 32)
	if _, err := rand.Read(body); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}

	return base64.RawURLEncoding.EncodeToString(body), nil
}

func newInvitationCode() (string, error) {
	body := make([]byte, 9)
	if _, err := rand.Read(body); err != nil {
		return "", fmt.Errorf("generate invitation code: %w", err)
	}

	return strings.ToUpper(base64.RawURLEncoding.EncodeToString(body)), nil
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeRole(value Role) Role {
	switch Role(strings.ToLower(strings.TrimSpace(string(value)))) {
	case RoleAdmin:
		return RoleAdmin
	case RoleUser:
		return RoleUser
	default:
		return ""
	}
}

func normalizeStatus(value Status) Status {
	switch Status(strings.ToLower(strings.TrimSpace(string(value)))) {
	case StatusActive:
		return StatusActive
	case StatusDisabled:
		return StatusDisabled
	default:
		return ""
	}
}

func normalizePermission(value Permission) Permission {
	switch Permission(strings.ToLower(strings.TrimSpace(string(value)))) {
	case PermissionAccounts:
		return PermissionAccounts
	case PermissionChats:
		return PermissionChats
	case PermissionScripts:
		return PermissionScripts
	case PermissionExports:
		return PermissionExports
	default:
		return ""
	}
}

func normalizePermissions(values []Permission) []Permission {
	seen := make(map[Permission]struct{})
	items := make([]Permission, 0, len(values))
	for _, value := range values {
		permission := normalizePermission(value)
		if permission == "" {
			continue
		}
		if _, exists := seen[permission]; exists {
			continue
		}
		seen[permission] = struct{}{}
		items = append(items, permission)
	}

	return items
}

func normalizeRoleOrExisting(value *Role, existing Role) Role {
	if value == nil {
		return existing
	}

	normalized := normalizeRole(*value)
	if normalized == "" {
		return existing
	}

	return normalized
}

func normalizeInvitationStatus(value InvitationStatus) InvitationStatus {
	switch InvitationStatus(strings.ToLower(strings.TrimSpace(string(value)))) {
	case InvitationStatusActive:
		return InvitationStatusActive
	case InvitationStatusDisabled:
		return InvitationStatusDisabled
	default:
		return ""
	}
}

func normalizeInviteCode(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

func mapUserError(id string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrUserNotFound, strings.TrimSpace(id))
	}

	return err
}

func requestUserAgent(r *http.Request) string {
	if r == nil {
		return ""
	}

	return strings.TrimSpace(r.UserAgent())
}

func requestIP(r *http.Request) string {
	if r == nil {
		return ""
	}

	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}

	return strings.TrimSpace(r.RemoteAddr)
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func timePointer(value time.Time) *time.Time {
	return &value
}
