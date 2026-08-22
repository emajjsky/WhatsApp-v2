package sessions

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"whatsapp-agent-platform/internal/ingest"
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

type SendResult struct {
	WAMessageID string
	SentAt      time.Time
}

type SendMediaInput struct {
	MediaType ingest.MediaType
	FileName  string
	MIMEType  string
	Caption   string
	Data      []byte
}

type textSender interface {
	SendText(ctx context.Context, accountID, chatJID, text string) (SendResult, error)
}

type mediaSender interface {
	SendMedia(ctx context.Context, accountID, chatJID string, input SendMediaInput) (SendResult, error)
}

type Manager struct {
	connector       Connector
	credentialStore *CredentialStoreAdapter
	logger          *slog.Logger
	mu              sync.RWMutex
	bridge          *EventBridge
	bridgeQueue     chan Event
	bridgeOnce      sync.Once
	subscribers     map[chan Event]struct{}
}

const bridgeQueueSize = 2048

type eventSource interface {
	SetEventHandler(handler func(Event))
}

type snapshotSource interface {
	ListSnapshots(ctx context.Context) ([]SessionSnapshot, error)
}

type restoreSource interface {
	Restore(ctx context.Context, accountID string) error
}

type reconnectSource interface {
	Reconnect(ctx context.Context, accountID string) error
}

func NewManager(connector Connector, credentialStore *CredentialStoreAdapter, logger *slog.Logger) *Manager {
	if logger == nil {
		logger = slog.Default()
	}
	if connector == nil {
		connector = NewPlaceholderConnector(logger)
	}

	manager := &Manager{
		connector:       connector,
		credentialStore: credentialStore,
		logger:          logger.With("component", "session_manager"),
		bridgeQueue:     make(chan Event, bridgeQueueSize),
		subscribers:     make(map[chan Event]struct{}),
	}

	if source, ok := connector.(eventSource); ok {
		source.SetEventHandler(manager.handleEvent)
	}

	return manager
}

func (m *Manager) SetEventBridge(bridge *EventBridge) {
	m.mu.Lock()
	m.bridge = bridge
	m.mu.Unlock()
	if bridge != nil {
		m.bridgeOnce.Do(func() {
			go m.processBridgeEvents()
		})
	}

	if source, ok := m.connector.(eventSource); ok {
		source.SetEventHandler(m.handleEvent)
	}
}

func (m *Manager) Subscribe(buffer int) (<-chan Event, func()) {
	if buffer <= 0 {
		buffer = 8
	}

	ch := make(chan Event, buffer)

	m.mu.Lock()
	m.subscribers[ch] = struct{}{}
	m.mu.Unlock()

	cancel := func() {
		m.mu.Lock()
		if _, ok := m.subscribers[ch]; ok {
			delete(m.subscribers, ch)
			close(ch)
		}
		m.mu.Unlock()
	}

	return ch, cancel
}

func (m *Manager) ListSnapshots(ctx context.Context) ([]SessionSnapshot, error) {
	source, ok := m.connector.(snapshotSource)
	if !ok {
		return nil, fmt.Errorf("session connector does not expose inventory")
	}

	return source.ListSnapshots(ctx)
}

func (m *Manager) Restore(ctx context.Context, accountID string) error {
	source, ok := m.connector.(restoreSource)
	if !ok {
		return nil
	}

	return source.Restore(ctx, accountID)
}

func (m *Manager) Reconnect(ctx context.Context, accountID string) error {
	source, ok := m.connector.(reconnectSource)
	if !ok {
		return nil
	}

	return source.Reconnect(ctx, accountID)
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
	handler  func(Event)
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
	c.mu.Unlock()

	c.logger.Info("placeholder pairing artifact issued", "account_id", accountID, "method", request.Method)
	c.emit(Event{
		Type:      EventTypeSessionSnapshot,
		AccountID: accountID,
		Snapshot:  cloneSnapshot(snapshot),
		EmittedAt: snapshot.UpdatedAt,
	})
	go c.simulatePairingLifecycle(accountID)

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

	snapshot, ok := c.sessions[accountID]
	if !ok {
		c.mu.Unlock()
		return ErrSessionNotFound
	}

	snapshot.Status = "logged_out"
	snapshot.Pairing = nil
	snapshot.UpdatedAt = c.now()
	c.sessions[accountID] = snapshot
	c.mu.Unlock()
	c.emit(Event{
		Type:      EventTypeSessionSnapshot,
		AccountID: accountID,
		Snapshot:  cloneSnapshot(snapshot),
		EmittedAt: snapshot.UpdatedAt,
	})

	return nil
}

func (c *PlaceholderConnector) SendText(_ context.Context, accountID, chatJID, text string) (SendResult, error) {
	trimmedChat := strings.TrimSpace(chatJID)
	if trimmedChat == "" {
		return SendResult{}, fmt.Errorf("chat_jid is required")
	}
	trimmedText := strings.TrimSpace(text)
	if trimmedText == "" {
		return SendResult{}, fmt.Errorf("text must not be empty")
	}

	c.mu.RLock()
	snapshot, ok := c.sessions[accountID]
	c.mu.RUnlock()
	if !ok {
		return SendResult{}, ErrSessionNotFound
	}
	if snapshot.Status != "connected" {
		return SendResult{}, fmt.Errorf("session is not connected")
	}

	messageID, err := randomToken(8)
	if err != nil {
		return SendResult{}, err
	}

	now := c.now()
	event := Event{
		Type:      EventTypeMessageReceived,
		AccountID: accountID,
		EmittedAt: now,
		Message: &MessageEnvelope{
			Chat: ingest.ChatSnapshot{
				AccountID:     accountID,
				WAChatJID:     trimmedChat,
				ChatType:      ingest.ChatTypeDirect,
				LastMessageAt: &now,
			},
			Message: ingest.MessageInput{
				AccountID:   accountID,
				WAMessageID: strings.ToUpper(messageID),
				SenderJID:   "me@wa",
				FromMe:      true,
				MessageType: ingest.MessageTypeText,
				TextContent: stringPointer(trimmedText),
				SentAt:      now,
			},
			Payload: map[string]any{
				"source": "placeholder-connector",
				"text":   trimmedText,
			},
		},
	}

	c.emit(event)

	return SendResult{
		WAMessageID: strings.ToUpper(messageID),
		SentAt:      now,
	}, nil
}

func (c *PlaceholderConnector) SendMedia(_ context.Context, accountID, chatJID string, input SendMediaInput) (SendResult, error) {
	trimmedChat := strings.TrimSpace(chatJID)
	if trimmedChat == "" {
		return SendResult{}, fmt.Errorf("chat_jid is required")
	}

	mediaType, messageType, err := normalizeOutgoingMediaType(input.MediaType)
	if err != nil {
		return SendResult{}, err
	}
	if len(input.Data) == 0 {
		return SendResult{}, fmt.Errorf("media payload is empty")
	}

	c.mu.RLock()
	snapshot, ok := c.sessions[accountID]
	c.mu.RUnlock()
	if !ok {
		return SendResult{}, ErrSessionNotFound
	}
	if snapshot.Status != "connected" {
		return SendResult{}, fmt.Errorf("session is not connected")
	}

	messageID, err := randomToken(8)
	if err != nil {
		return SendResult{}, err
	}

	now := c.now()
	waMessageID := strings.ToUpper(messageID)
	mimeType := normalizedMIMEType(input.MIMEType, input.Data)
	fileName := strings.TrimSpace(input.FileName)
	caption := strings.TrimSpace(input.Caption)

	storageKey, checksum, resolvedName, err := storeMediaFile(accountID, waMessageID, mediaType, stringPointer(mimeType), nil, input.Data)
	displayName := fileName
	if displayName == "" {
		displayName = resolvedName
	}
	media := ingest.MediaInput{
		MediaType:      mediaType,
		MIMEType:       stringPointer(mimeType),
		FileName:       stringPointer(displayName),
		ByteSize:       int64Pointer(int64(len(input.Data))),
		DownloadStatus: ingest.DownloadStatusReady,
	}
	if err != nil {
		c.logger.Warn("failed to persist placeholder media attachment", "account_id", accountID, "message_id", waMessageID, "media_type", mediaType, "error", err)
		media.DownloadStatus = ingest.DownloadStatusFailed
	} else {
		media.StorageKey = &storageKey
		media.SHA256 = &checksum
	}

	var textContent *string
	if caption != "" && mediaType != ingest.MediaTypeAudio {
		textContent = stringPointer(caption)
	}

	c.emit(Event{
		Type:      EventTypeMessageReceived,
		AccountID: accountID,
		EmittedAt: now,
		Message: &MessageEnvelope{
			Chat: ingest.ChatSnapshot{
				AccountID:     accountID,
				WAChatJID:     trimmedChat,
				ChatType:      ingest.ChatTypeDirect,
				LastMessageAt: &now,
			},
			Message: ingest.MessageInput{
				AccountID:   accountID,
				WAMessageID: waMessageID,
				SenderJID:   "me@wa",
				FromMe:      true,
				MessageType: messageType,
				TextContent: textContent,
				SentAt:      now,
			},
			Media: []ingest.MediaInput{media},
			Payload: map[string]any{
				"source":     "placeholder-connector",
				"media_type": mediaType,
				"file_name":  displayName,
			},
		},
	})

	return SendResult{
		WAMessageID: waMessageID,
		SentAt:      now,
	}, nil
}

func (m *Manager) SendText(ctx context.Context, accountID, chatJID, text string) (SendResult, error) {
	sender, ok := m.connector.(textSender)
	if !ok {
		return SendResult{}, fmt.Errorf("session connector does not support sending messages")
	}

	return sender.SendText(ctx, accountID, chatJID, text)
}

func (m *Manager) SendMedia(ctx context.Context, accountID, chatJID string, input SendMediaInput) (SendResult, error) {
	sender, ok := m.connector.(mediaSender)
	if !ok {
		return SendResult{}, fmt.Errorf("session connector does not support sending media messages")
	}

	return sender.SendMedia(ctx, accountID, chatJID, input)
}

func (c *PlaceholderConnector) SetEventHandler(handler func(Event)) {
	c.mu.Lock()
	c.handler = handler
	c.mu.Unlock()
}

func (c *PlaceholderConnector) ListSnapshots(_ context.Context) ([]SessionSnapshot, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	items := make([]SessionSnapshot, 0, len(c.sessions))
	for _, snapshot := range c.sessions {
		items = append(items, *cloneSnapshot(snapshot))
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items, nil
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

func (m *Manager) handleEvent(event Event) {
	if event.AccountID == "" {
		switch {
		case event.Snapshot != nil:
			event.AccountID = event.Snapshot.AccountID
		case event.Message != nil:
			event.AccountID = event.Message.Message.AccountID
		}
	}
	if event.EmittedAt.IsZero() {
		event.EmittedAt = time.Now().UTC()
	}

	m.mu.RLock()
	bridge := m.bridge
	m.mu.RUnlock()
	if bridge == nil {
		m.publishEvent(event)
		return
	}

	// Applying backpressure here preserves event order and prevents unbounded
	// goroutine growth while a history sync is writing many messages.
	m.bridgeQueue <- event
}

func (m *Manager) processBridgeEvents() {
	for event := range m.bridgeQueue {
		m.mu.RLock()
		bridge := m.bridge
		m.mu.RUnlock()
		if bridge == nil {
			m.publishEvent(event)
			continue
		}

		if err := bridge.Handle(context.Background(), event); err != nil {
			m.logger.Error(
				"failed to process session event",
				"account_id", event.AccountID,
				"type", event.Type,
				"error", err,
			)
			continue
		}
		m.publishEvent(event)
	}
}

func (m *Manager) publishEvent(event Event) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for subscriber := range m.subscribers {
		select {
		case subscriber <- event:
		default:
		}
	}
}

func (c *PlaceholderConnector) simulatePairingLifecycle(accountID string) {
	time.Sleep(900 * time.Millisecond)

	snapshot, ok := c.transitionSession(accountID, func(snapshot SessionSnapshot, now time.Time) SessionSnapshot {
		if snapshot.Status != "pairing" {
			return snapshot
		}

		snapshot.Status = "connected"
		snapshot.Pairing = nil
		snapshot.UpdatedAt = now
		snapshot.ConnectedAt = &now
		snapshot.LastError = ""
		return snapshot
	})
	if !ok {
		return
	}

	c.emit(Event{
		Type:      EventTypeSessionSnapshot,
		AccountID: accountID,
		Snapshot:  cloneSnapshot(snapshot),
		EmittedAt: snapshot.UpdatedAt,
	})

	time.Sleep(350 * time.Millisecond)
	c.emitDemoMessage(accountID, "customer-demo@wa", "customer-demo@wa", "演示客户", "你好，我想确认一下今天的订单什么时候可以发货？", false)

	time.Sleep(250 * time.Millisecond)
	c.emitDemoMessage(accountID, "customer-demo@wa", "customer-demo@wa", "演示客户", "如果今天发不了，麻烦直接告诉我一个准确时间。", false)
}

func (c *PlaceholderConnector) transitionSession(accountID string, mutate func(SessionSnapshot, time.Time) SessionSnapshot) (SessionSnapshot, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	current, ok := c.sessions[accountID]
	if !ok {
		return SessionSnapshot{}, false
	}

	next := mutate(current, c.now())
	if next == current {
		return SessionSnapshot{}, false
	}

	c.sessions[accountID] = next
	return next, true
}

func (c *PlaceholderConnector) emitDemoMessage(accountID, chatJID, senderJID, title, text string, fromMe bool) {
	c.mu.RLock()
	snapshot, ok := c.sessions[accountID]
	c.mu.RUnlock()
	if !ok || snapshot.Status != "connected" {
		return
	}

	messageID, err := randomToken(8)
	if err != nil {
		c.logger.Warn("failed to generate placeholder message id", "account_id", accountID, "error", err)
		return
	}

	now := c.now()
	event := Event{
		Type:      EventTypeMessageReceived,
		AccountID: accountID,
		EmittedAt: now,
		Message: &MessageEnvelope{
			Chat: ingest.ChatSnapshot{
				AccountID:     accountID,
				WAChatJID:     chatJID,
				ChatType:      ingest.ChatTypeDirect,
				Title:         stringPointer(title),
				LastMessageAt: &now,
			},
			Contact: &ingest.ContactSnapshot{
				AccountID:   accountID,
				WAJID:       senderJID,
				DisplayName: stringPointer(title),
				PushName:    stringPointer(title),
			},
			Message: ingest.MessageInput{
				AccountID:   accountID,
				WAMessageID: strings.ToUpper(messageID),
				SenderJID:   senderJID,
				FromMe:      fromMe,
				MessageType: ingest.MessageTypeText,
				TextContent: stringPointer(text),
				SentAt:      now,
			},
			Payload: map[string]any{
				"source": "placeholder-connector",
				"text":   text,
			},
		},
	}

	c.emit(event)
}

func (c *PlaceholderConnector) emit(event Event) {
	c.mu.RLock()
	handler := c.handler
	c.mu.RUnlock()

	if handler != nil {
		handler(event)
	}
}

func cloneSnapshot(snapshot SessionSnapshot) *SessionSnapshot {
	cloned := snapshot
	if snapshot.Pairing != nil {
		pairing := *snapshot.Pairing
		cloned.Pairing = &pairing
	}
	if snapshot.ConnectedAt != nil {
		connectedAt := *snapshot.ConnectedAt
		cloned.ConnectedAt = &connectedAt
	}

	return &cloned
}

func stringPointer(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}

	result := value
	return &result
}
