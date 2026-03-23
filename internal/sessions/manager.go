package sessions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"
)

var ErrSessionNotFound = errors.New("session not found")

type PairingMethod string

const (
	PairingMethodQR          PairingMethod = "qr"
	PairingMethodPairingCode PairingMethod = "pairing_code"
)

type PairingArtifact struct {
	Method      PairingMethod `json:"method"`
	QRCode      string        `json:"qr_code,omitempty"`
	PairingCode string        `json:"pairing_code,omitempty"`
	Instruction string        `json:"instruction"`
	ExpiresAt   time.Time     `json:"expires_at"`
}

type SessionSnapshot struct {
	AccountID   string           `json:"account_id"`
	Status      string           `json:"status"`
	Pairing     *PairingArtifact `json:"pairing,omitempty"`
	LastError   string           `json:"last_error,omitempty"`
	ConnectedAt *time.Time       `json:"connected_at,omitempty"`
	UpdatedAt   time.Time        `json:"updated_at"`
}

type StartPairingRequest struct {
	Method PairingMethod `json:"method"`
}

type Connector interface {
	StartPairing(ctx context.Context, accountID string, request StartPairingRequest) (SessionSnapshot, error)
	Status(ctx context.Context, accountID string) (SessionSnapshot, error)
	Logout(ctx context.Context, accountID string) error
}

type Manager struct {
	connector       Connector
	credentialStore *CredentialStoreAdapter
	logger          *slog.Logger
}

func NewManager(connector Connector, credentialStore *CredentialStoreAdapter, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	if connector == nil {
		connector = NewPlaceholderConnector(logger)
	}

	return &Manager{
		connector:       connector,
		credentialStore: credentialStore,
		logger:          logger.With("component", "session_manager"),
	}
}

func (m *Manager) StartPairing(ctx context.Context, accountID string, request StartPairingRequest) (SessionSnapshot, error) {
	request.Method = normalizePairingMethod(request.Method)

	snapshot, err := m.connector.StartPairing(ctx, accountID, request)
	if err != nil {
		return SessionSnapshot{}, err
	}

	m.logger.Info(
		"pairing session started",
		"account_id", accountID,
		"method", request.Method,
		"status", snapshot.Status,
	)

	return snapshot, nil
}

func (m *Manager) GetStatus(ctx context.Context, accountID string) (SessionSnapshot, error) {
	return m.connector.Status(ctx, accountID)
}

func (m *Manager) Logout(ctx context.Context, accountID string) error {
	if err := m.connector.Logout(ctx, accountID); err != nil {
		return err
	}

	if m.credentialStore != nil {
		if err := m.credentialStore.Delete(ctx, accountID); err != nil {
			m.logger.Warn("failed to delete credential snapshot during logout", "account_id", accountID, "error", err)
		}
	}

	m.logger.Info("session logged out", "account_id", accountID)
	return nil
}

func normalizePairingMethod(method PairingMethod) PairingMethod {
	switch strings.ToLower(strings.TrimSpace(string(method))) {
	case "", string(PairingMethodQR):
		return PairingMethodQR
	case string(PairingMethodPairingCode):
		return PairingMethodPairingCode
	default:
		return PairingMethodQR
	}
}

type PlaceholderConnector struct {
	mu       sync.RWMutex
	sessions map[string]SessionSnapshot
	logger   *slog.Logger
	now      func() time.Time
}

func NewPlaceholderConnector(logger *slog.Logger) *PlaceholderConnector {
	if logger == nil {
		logger = slog.Default()
	}

	return &PlaceholderConnector{
		sessions: make(map[string]SessionSnapshot),
		logger:   logger.With("component", "placeholder_session_connector"),
		now:      func() time.Time { return time.Now().UTC() },
	}
}

func (c *PlaceholderConnector) StartPairing(_ context.Context, accountID string, request StartPairingRequest) (SessionSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := c.now()
	artifact := &PairingArtifact{
		Method:      request.Method,
		Instruction: placeholderInstruction(request.Method),
		ExpiresAt:   now.Add(60 * time.Second),
	}

	switch request.Method {
	case PairingMethodPairingCode:
		code, err := generatePairingCode()
		if err != nil {
			return SessionSnapshot{}, err
		}
		artifact.PairingCode = code
	default:
		token, err := randomToken(12)
		if err != nil {
			return SessionSnapshot{}, err
		}
		artifact.QRCode = fmt.Sprintf("wa-platform://pair/%s/%s", accountID, token)
	}

	snapshot := SessionSnapshot{
		AccountID: accountID,
		Status:    "pairing",
		Pairing:   artifact,
		UpdatedAt: now,
	}

	c.sessions[accountID] = snapshot
	c.logger.Info("placeholder pairing artifact issued", "account_id", accountID, "method", request.Method)

	return snapshot, nil
}

func (c *PlaceholderConnector) Status(_ context.Context, accountID string) (SessionSnapshot, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	snapshot, ok := c.sessions[accountID]
	if !ok {
		return SessionSnapshot{}, ErrSessionNotFound
	}

	return snapshot, nil
}

func (c *PlaceholderConnector) Logout(_ context.Context, accountID string) error {
	c.mu.Lock()
	defer c.mu.Unlock()

	snapshot, ok := c.sessions[accountID]
	if !ok {
		return ErrSessionNotFound
	}

	snapshot.Status = "logged_out"
	snapshot.Pairing = nil
	snapshot.UpdatedAt = c.now()
	c.sessions[accountID] = snapshot

	return nil
}

func placeholderInstruction(method PairingMethod) string {
	if method == PairingMethodPairingCode {
		return "Use the pairing code flow in the future whatsmeow gateway once live protocol wiring is enabled."
	}

	return "Render the QR payload in the admin console and complete pairing before opening chat operations."
}

func generatePairingCode() (string, error) {
	token, err := randomToken(4)
	if err != nil {
		return "", err
	}

	return strings.ToUpper(token[:4] + "-" + token[4:8]), nil
}

func randomToken(byteLength int) (string, error) {
	buffer := make([]byte, byteLength)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("generate random token: %w", err)
	}

	return hex.EncodeToString(buffer), nil
}
