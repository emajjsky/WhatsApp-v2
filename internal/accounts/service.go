package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/proxies"
	"whatsapp-agent-platform/internal/sessions"
	"whatsapp-agent-platform/internal/support/ids"
)

var ErrAccountNotFound = errors.New("account not found")

type SessionLifecycle interface {
	StartPairing(ctx context.Context, accountID string, request sessions.StartPairingRequest) (sessions.SessionSnapshot, error)
	GetStatus(ctx context.Context, accountID string) (sessions.SessionSnapshot, error)
	Logout(ctx context.Context, accountID string) error
}

type Service struct {
	repository       *Repository
	sessionLifecycle SessionLifecycle
	proxyService     *proxies.Service
	now              func() time.Time
}

const (
	sessionStatusTimeout   = 350 * time.Millisecond
	logoutOperationTimeout = 8 * time.Second
	proxyReconnectTimeout  = 30 * time.Second
)

type sessionReconnector interface {
	Reconnect(ctx context.Context, accountID string) error
}

type CreateAccountInput struct {
	DisplayName   string  `json:"display_name"`
	PhoneNumber   *string `json:"phone_number,omitempty"`
	PlatformLabel *string `json:"platform_label,omitempty"`
}

type SessionView struct {
	Status      string                    `json:"status"`
	LastError   string                    `json:"last_error,omitempty"`
	UpdatedAt   time.Time                 `json:"updated_at"`
	ConnectedAt *time.Time                `json:"connected_at,omitempty"`
	Pairing     *sessions.PairingArtifact `json:"pairing,omitempty"`
}

type AccountView struct {
	ID            string       `json:"id"`
	UserID        string       `json:"user_id,omitempty"`
	DisplayName   string       `json:"display_name"`
	PhoneNumber   *string      `json:"phone_number,omitempty"`
	Status        string       `json:"status"`
	PlatformLabel *string      `json:"platform_label,omitempty"`
	LastSeenAt    *time.Time   `json:"last_seen_at,omitempty"`
	CreatedAt     time.Time    `json:"created_at"`
	UpdatedAt     time.Time    `json:"updated_at"`
	Session       *SessionView `json:"session,omitempty"`
}

func NewService(repository *Repository, sessionLifecycle SessionLifecycle) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("account service requires a repository")
	}

	return &Service{
		repository:       repository,
		sessionLifecycle: sessionLifecycle,
		now:              func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *Service) SetProxyService(proxyService *proxies.Service) {
	s.proxyService = proxyService
}

func (s *Service) CreateAccount(ctx context.Context, input CreateAccountInput) (AccountView, error) {
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		return AccountView{}, fmt.Errorf("display_name is required")
	}

	account := Account{
		ID:            generateAccountID(),
		UserID:        currentUserID(ctx),
		DisplayName:   displayName,
		PhoneNumber:   normalizedOptionalString(input.PhoneNumber),
		Status:        "pending",
		PlatformLabel: normalizedOptionalString(input.PlatformLabel),
	}

	if err := s.repository.Create(ctx, account); err != nil {
		return AccountView{}, err
	}

	stored, err := s.repository.GetByID(ctx, account.ID)
	if err != nil {
		return AccountView{}, err
	}

	return mapAccountToView(stored, nil), nil
}

func (s *Service) ListAccounts(ctx context.Context) ([]AccountView, error) {
	items, err := s.repository.List(ctx)
	if err != nil {
		return nil, err
	}

	views := make([]AccountView, 0, len(items))
	for _, item := range items {
		sessionView, sessionErr := s.getSessionView(ctx, item.ID)
		if sessionErr == nil && sessionView != nil {
			item.Status = sessionView.Status
		}

		views = append(views, mapAccountToView(item, sessionView))
	}

	return views, nil
}

func (s *Service) StartPairing(ctx context.Context, accountID string, method sessions.PairingMethod) (AccountView, error) {
	return s.StartPairingWithOptions(ctx, accountID, method, false)
}

func (s *Service) StartPairingWithOptions(ctx context.Context, accountID string, method sessions.PairingMethod, allowLocalNetwork bool) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}
	if s.sessionLifecycle == nil {
		return AccountView{}, fmt.Errorf("session lifecycle is not configured")
	}
	if s.proxyService != nil {
		proxyErr := s.proxyService.ValidateAccountProxy(ctx, accountID)
		if proxyErr != nil {
			if !(allowLocalNetwork && strings.Contains(proxyErr.Error(), "请先在“IP代理”页面配置并验证账号网络出口")) {
				return AccountView{}, proxyErr
			}
			// 本机网络是用户明确选择的测试模式，不是代理缺失时的静默回退。
		}
	}

	sessionSnapshot, err := s.sessionLifecycle.StartPairing(ctx, accountID, sessions.StartPairingRequest{Method: method})
	if err != nil {
		return AccountView{}, err
	}

	if err := s.repository.UpdateStatus(ctx, accountID, sessionSnapshot.Status, nil); err != nil {
		return AccountView{}, err
	}

	account.Status = sessionSnapshot.Status
	account.UpdatedAt = s.now()

	return mapAccountToView(account, mapSessionToView(sessionSnapshot)), nil
}

func (s *Service) GetAccountStatus(ctx context.Context, accountID string) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}

	sessionView, sessionErr := s.getSessionView(ctx, accountID)
	switch {
	case sessionErr == nil && sessionView != nil:
		account.Status = sessionView.Status
	case errors.Is(sessionErr, sessions.ErrSessionNotFound), errors.Is(sessionErr, context.DeadlineExceeded), errors.Is(sessionErr, context.Canceled), sessionErr == nil:
		// Fall back to the persisted account status so a stuck live connector doesn't blank the page.
	default:
		return AccountView{}, sessionErr
	}

	return mapAccountToView(account, sessionView), nil
}

func (s *Service) Logout(ctx context.Context, accountID string) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}
	if s.sessionLifecycle == nil {
		return AccountView{}, fmt.Errorf("session lifecycle is not configured")
	}

	if err := s.logoutSession(ctx, accountID); err != nil && !errors.Is(err, sessions.ErrSessionNotFound) {
		return AccountView{}, err
	}

	if err := s.repository.UpdateStatus(ctx, accountID, "logged_out", nil); err != nil {
		return AccountView{}, err
	}

	account.Status = "logged_out"
	account.UpdatedAt = s.now()

	return mapAccountToView(account, &SessionView{
		Status:    "logged_out",
		UpdatedAt: s.now(),
	}), nil
}

func (s *Service) GetAccountProxy(ctx context.Context, accountID string) (*proxies.View, error) {
	if _, err := s.repository.GetByID(ctx, accountID); err != nil {
		return nil, mapRepositoryError(accountID, err)
	}
	if s.proxyService == nil {
		return nil, fmt.Errorf("local proxy pool is not configured")
	}
	return s.proxyService.GetAccountProxy(ctx, accountID)
}

func (s *Service) SetAccountProxy(ctx context.Context, accountID, proxyID string) (*proxies.View, error) {
	if _, err := s.repository.GetByID(ctx, accountID); err != nil {
		return nil, mapRepositoryError(accountID, err)
	}
	if s.proxyService == nil {
		return nil, fmt.Errorf("local proxy pool is not configured")
	}

	proxyID = strings.TrimSpace(proxyID)
	current, err := s.proxyService.GetAccountProxy(ctx, accountID)
	if err != nil {
		return nil, err
	}
	currentID := ""
	if current != nil {
		currentID = current.ID
	}
	if currentID == proxyID {
		return current, nil
	}

	updated, err := s.proxyService.SetAccountProxy(ctx, accountID, proxyID)
	if err != nil {
		return nil, err
	}
	if updated != nil && (updated.LastCheckedAt == nil || updated.LastCheckError != nil || !updated.Enabled) {
		return updated, nil
	}

	reconnector, ok := s.sessionLifecycle.(sessionReconnector)
	if !ok {
		return updated, nil
	}
	reconnectCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), proxyReconnectTimeout)
	defer cancel()
	if err := reconnector.Reconnect(reconnectCtx, accountID); err != nil {
		return updated, fmt.Errorf("proxy binding was saved but reconnect failed: %w", err)
	}
	return updated, nil
}

func (s *Service) DeleteAccount(ctx context.Context, accountID string) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}

	// Best-effort logout to avoid leaving a live session around. We still allow deletion
	// even if logout fails due to network/protocol issues.
	if s.sessionLifecycle != nil {
		_ = s.logoutSession(ctx, accountID)
	}

	if err := s.repository.Delete(ctx, accountID); err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}

	return mapAccountToView(account, nil), nil
}

func mapRepositoryError(accountID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrAccountNotFound, accountID)
	}

	return err
}

func mapAccountToView(account Account, session *SessionView) AccountView {
	return AccountView{
		ID:            account.ID,
		UserID:        account.UserID,
		DisplayName:   account.DisplayName,
		PhoneNumber:   account.PhoneNumber,
		Status:        account.Status,
		PlatformLabel: account.PlatformLabel,
		LastSeenAt:    account.LastSeenAt,
		CreatedAt:     account.CreatedAt,
		UpdatedAt:     account.UpdatedAt,
		Session:       session,
	}
}

func currentUserID(ctx context.Context) string {
	user, ok := auth.CurrentUser(ctx)
	if !ok {
		return ""
	}

	return user.ID
}

func mapSessionToView(snapshot sessions.SessionSnapshot) *SessionView {
	return &SessionView{
		Status:      snapshot.Status,
		LastError:   snapshot.LastError,
		UpdatedAt:   snapshot.UpdatedAt,
		ConnectedAt: snapshot.ConnectedAt,
		Pairing:     snapshot.Pairing,
	}
}

func normalizedOptionalString(value *string) *string {
	if value == nil {
		return nil
	}

	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func generateAccountID() string {
	return ids.NewUUID()
}

func (s *Service) getSessionView(ctx context.Context, accountID string) (*SessionView, error) {
	if s.sessionLifecycle == nil {
		return nil, nil
	}

	sessionSnapshot, err := s.getSessionSnapshotWithTimeout(ctx, accountID, sessionStatusTimeout)
	switch {
	case err == nil:
		return mapSessionToView(sessionSnapshot), nil
	case errors.Is(err, sessions.ErrSessionNotFound):
		return nil, err
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return nil, err
	default:
		return nil, err
	}
}

func (s *Service) getSessionSnapshotWithTimeout(ctx context.Context, accountID string, timeout time.Duration) (sessions.SessionSnapshot, error) {
	type result struct {
		snapshot sessions.SessionSnapshot
		err      error
	}

	resultCh := make(chan result, 1)
	go func() {
		snapshot, err := s.sessionLifecycle.GetStatus(ctx, accountID)
		resultCh <- result{snapshot: snapshot, err: err}
	}()

	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case res := <-resultCh:
		return res.snapshot, res.err
	case <-ctx.Done():
		return sessions.SessionSnapshot{}, ctx.Err()
	case <-timer.C:
		return sessions.SessionSnapshot{}, context.DeadlineExceeded
	}
}

func (s *Service) logoutSession(ctx context.Context, accountID string) error {
	if s.sessionLifecycle == nil {
		return fmt.Errorf("session lifecycle is not configured")
	}

	logoutCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), logoutOperationTimeout)
	defer cancel()

	return s.sessionLifecycle.Logout(logoutCtx, accountID)
}
