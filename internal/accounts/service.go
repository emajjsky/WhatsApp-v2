package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

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
	now              func() time.Time
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

func (s *Service) CreateAccount(ctx context.Context, input CreateAccountInput) (AccountView, error) {
	displayName := strings.TrimSpace(input.DisplayName)
	if displayName == "" {
		return AccountView{}, fmt.Errorf("display_name is required")
	}

	account := Account{
		ID:            generateAccountID(),
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
		var sessionView *SessionView
		if s.sessionLifecycle != nil {
			if session, err := s.sessionLifecycle.GetStatus(ctx, item.ID); err == nil {
				sessionView = mapSessionToView(session)
			}
		}

		views = append(views, mapAccountToView(item, sessionView))
	}

	return views, nil
}

func (s *Service) StartPairing(ctx context.Context, accountID string, method sessions.PairingMethod) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}
	if s.sessionLifecycle == nil {
		return AccountView{}, fmt.Errorf("session lifecycle is not configured")
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

	var sessionView *SessionView
	if s.sessionLifecycle != nil {
		sessionSnapshot, sessionErr := s.sessionLifecycle.GetStatus(ctx, accountID)
		switch {
		case sessionErr == nil:
			sessionView = mapSessionToView(sessionSnapshot)
			account.Status = sessionSnapshot.Status
		case errors.Is(sessionErr, sessions.ErrSessionNotFound):
			sessionView = nil
		default:
			return AccountView{}, sessionErr
		}
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

	if err := s.sessionLifecycle.Logout(ctx, accountID); err != nil && !errors.Is(err, sessions.ErrSessionNotFound) {
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

func (s *Service) DeleteAccount(ctx context.Context, accountID string) (AccountView, error) {
	account, err := s.repository.GetByID(ctx, accountID)
	if err != nil {
		return AccountView{}, mapRepositoryError(accountID, err)
	}

	// Best-effort logout to avoid leaving a live session around. We still allow deletion
	// even if logout fails due to network/protocol issues.
	if s.sessionLifecycle != nil {
		_ = s.sessionLifecycle.Logout(ctx, accountID)
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
