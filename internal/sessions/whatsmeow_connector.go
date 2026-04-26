package sessions

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	waProto "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	waTypes "go.mau.fi/whatsmeow/types"
	waEvents "go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	"go.mau.fi/whatsmeow"

	"whatsapp-agent-platform/internal/ingest"
)

type AccountPhoneLookup interface {
	LookupPhone(ctx context.Context, accountID string) (*string, error)
}

type restorableConnector interface {
	Restore(ctx context.Context, accountID string) error
}

type whatsmeowSession struct {
	accountID string
	client    *whatsmeow.Client
	snapshot  SessionSnapshot
	cancelQR  context.CancelFunc

	catchUpUntil     time.Time
	catchUpRequested map[string]time.Time
}

type historyChatMeta struct {
	Title            *string
	Archived         bool
	ParticipantCount *int
}

type WhatsmeowConnector struct {
	mu           sync.RWMutex
	db           *sql.DB
	container    *sqlstore.Container
	bindingStore *CredentialStoreAdapter
	phoneLookup  AccountPhoneLookup
	proxyURL     string
	logger       *slog.Logger
	now          func() time.Time

	sessions map[string]*whatsmeowSession
	handler  func(Event)
}

const (
	catchUpWindow           = 3 * time.Minute
	catchUpMessageCount     = 50
	catchUpChatRequestLimit = 12
	catchUpRequestTimeout   = 20 * time.Second
	metadataRefreshTimeout  = 45 * time.Second
	groupInfoRequestTimeout = 8 * time.Second
	logoutRequestTimeout    = 8 * time.Second
)

func NewWhatsmeowConnector(
	db *sql.DB,
	bindingStore *CredentialStoreAdapter,
	phoneLookup AccountPhoneLookup,
	proxyURL string,
	logger *slog.Logger,
) (*WhatsmeowConnector, error) {
	if db == nil {
		return nil, fmt.Errorf("whatsmeow connector requires a database handle")
	}
	if logger == nil {
		logger = slog.Default()
	}

	container := sqlstore.NewWithDB(db, "postgres", newWhatsmeowLogger(logger))
	if err := container.Upgrade(context.Background()); err != nil {
		return nil, fmt.Errorf("upgrade whatsmeow sqlstore: %w", err)
	}

	return &WhatsmeowConnector{
		db:           db,
		container:    container,
		bindingStore: bindingStore,
		phoneLookup:  phoneLookup,
		proxyURL:     strings.TrimSpace(proxyURL),
		logger:       logger.With("component", "whatsmeow_connector"),
		now:          func() time.Time { return time.Now().UTC() },
		sessions:     make(map[string]*whatsmeowSession),
		handler:      nil,
	}, nil
}

func (c *WhatsmeowConnector) SetEventHandler(handler func(Event)) {
	c.mu.Lock()
	c.handler = handler
	c.mu.Unlock()
}

func (c *WhatsmeowConnector) StartPairing(ctx context.Context, accountID string, request StartPairingRequest) (SessionSnapshot, error) {
	session, err := c.ensureSession(ctx, accountID)
	if err != nil {
		return SessionSnapshot{}, err
	}

	if session.client.IsConnected() && session.client.IsLoggedIn() {
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "connected"
			snapshot.Pairing = nil
			if snapshot.ConnectedAt == nil {
				now := c.now()
				snapshot.ConnectedAt = &now
			}
			snapshot.LastError = ""
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		c.emitSnapshot(snapshot)
		c.refreshKnownMetadataAsync(accountID)
		return snapshot, nil
	}

	if session.client.Store.ID != nil {
		return c.connectExistingSession(ctx, accountID, session)
	}

	if session.cancelQR != nil {
		session.cancelQR()
		session.cancelQR = nil
	}

	qrCtx, cancelQR := context.WithCancel(context.Background())
	qrChan, err := session.client.GetQRChannel(qrCtx)
	if err != nil {
		cancelQR()
		return SessionSnapshot{}, fmt.Errorf("prepare qr channel: %w", err)
	}

	session.cancelQR = cancelQR
	if err := session.client.Connect(); err != nil {
		cancelQR()
		session.cancelQR = nil
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", fmt.Sprintf("connect whatsapp session: %v", err))
	}

	firstItem, ok := c.awaitQRItem(ctx, qrChan)
	if !ok {
		cancelQR()
		session.cancelQR = nil
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", "timed out waiting for whatsapp pairing artifact")
	}

	var snapshot SessionSnapshot
	switch request.Method {
	case PairingMethodPairingCode:
		snapshot, err = c.startPairingCodeFlow(ctx, accountID, session)
	default:
		snapshot, err = c.startQRFlow(accountID, firstItem)
	}
	if err != nil {
		cancelQR()
		session.cancelQR = nil
		return SessionSnapshot{}, err
	}

	go c.consumeQRChannel(accountID, qrChan)
	return snapshot, nil
}

func (c *WhatsmeowConnector) Restore(ctx context.Context, accountID string) error {
	session, err := c.ensureSession(ctx, accountID)
	if err != nil {
		return err
	}
	if session.client.Store.ID == nil || session.client.IsConnected() {
		return nil
	}

	_, err = c.connectExistingSession(ctx, accountID, session)
	if err != nil && !strings.Contains(err.Error(), "failed") {
		return err
	}
	return nil
}

func (c *WhatsmeowConnector) Status(ctx context.Context, accountID string) (SessionSnapshot, error) {
	session, found := c.getSession(accountID)
	if found {
		return session.snapshot, nil
	}

	deviceID, err := c.loadDeviceBinding(ctx, accountID)
	if err != nil {
		return SessionSnapshot{}, err
	}
	if deviceID == nil {
		return SessionSnapshot{}, ErrSessionNotFound
	}

	// Keep account list/status reads non-blocking. A persisted device binding means this
	// account had a real session before, but we intentionally avoid spinning up or probing
	// a whatsmeow client from a read path because that can stall the whole /api/accounts
	// response when live protocol handling is busy.
	return SessionSnapshot{
		AccountID: accountID,
		Status:    "disconnected",
		UpdatedAt: c.now(),
	}, nil
}

func (c *WhatsmeowConnector) Logout(ctx context.Context, accountID string) error {
	session, found := c.getSession(accountID)
	if !found {
		deviceID, err := c.loadDeviceBinding(ctx, accountID)
		if err != nil {
			return err
		}
		if deviceID == nil {
			return ErrSessionNotFound
		}
		var errEnsure error
		session, errEnsure = c.ensureSession(ctx, accountID)
		if errEnsure != nil {
			return errEnsure
		}
	}

	if session.cancelQR != nil {
		session.cancelQR()
		session.cancelQR = nil
	}

	if session.client == nil {
		c.removeSession(accountID)
		return nil
	}

	if session.client.IsConnected() && session.client.IsLoggedIn() {
		logoutCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), logoutRequestTimeout)
		err := session.client.Logout(logoutCtx)
		cancel()
		if err != nil {
			c.logger.Warn(
				"failed to logout whatsapp session remotely; continuing local cleanup",
				"account_id", accountID,
				"error", err,
			)
		}
	}

	session.client.Disconnect()

	if session.client.Store != nil && session.client.Store.ID != nil {
		storeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), logoutRequestTimeout)
		err := session.client.Store.Delete(storeCtx)
		cancel()
		if err != nil {
			c.logger.Warn(
				"failed to delete whatsapp device store during logout",
				"account_id", accountID,
				"error", err,
			)
		}
	}

	if c.bindingStore != nil {
		bindingCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), logoutRequestTimeout)
		err := c.bindingStore.Delete(bindingCtx, accountID)
		cancel()
		if err != nil {
			c.logger.Warn("failed to delete session binding", "account_id", accountID, "error", err)
		}
	}

	snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
		snapshot.Status = "logged_out"
		snapshot.Pairing = nil
		snapshot.LastError = ""
		snapshot.ConnectedAt = nil
		snapshot.UpdatedAt = c.now()
		return snapshot
	})
	c.emitSnapshot(snapshot)
	c.removeSession(accountID)
	return nil
}

func (c *WhatsmeowConnector) SendText(ctx context.Context, accountID, chatJID, text string) (SendResult, error) {
	trimmedChat := strings.TrimSpace(chatJID)
	if trimmedChat == "" {
		return SendResult{}, fmt.Errorf("chat_jid is required")
	}
	trimmedText := strings.TrimSpace(text)
	if trimmedText == "" {
		return SendResult{}, fmt.Errorf("text must not be empty")
	}

	session, err := c.ensureSession(ctx, accountID)
	if err != nil {
		return SendResult{}, err
	}
	if !session.client.IsConnected() || !session.client.IsLoggedIn() {
		return SendResult{}, fmt.Errorf("whatsapp session is not connected")
	}

	targetJID, err := waTypes.ParseJID(trimmedChat)
	if err != nil {
		return SendResult{}, fmt.Errorf("parse chat jid %q: %w", trimmedChat, err)
	}
	targetJID = targetJID.ToNonAD()

	resp, err := session.client.SendMessage(ctx, targetJID, &waProto.Message{
		Conversation: proto.String(trimmedText),
	})
	if err != nil {
		return SendResult{}, fmt.Errorf("send whatsapp message: %w", err)
	}

	sentAt := resp.Timestamp
	if sentAt.IsZero() {
		sentAt = c.now()
	}

	senderJID := resp.Sender.ToNonAD()
	if senderJID.IsEmpty() && session.client.Store != nil && session.client.Store.ID != nil {
		senderJID = session.client.Store.ID.ToNonAD()
	}

	messageID := string(resp.ID)
	envelope := &MessageEnvelope{
		Chat: ingest.ChatSnapshot{
			AccountID:     accountID,
			WAChatJID:     targetJID.String(),
			ChatType:      mapChatType(targetJID),
			LastMessageAt: &sentAt,
		},
		Contact: nil,
		Message: ingest.MessageInput{
			AccountID:   accountID,
			WAMessageID: messageID,
			SenderJID:   senderJID.String(),
			FromMe:      true,
			MessageType: ingest.MessageTypeText,
			TextContent: stringPointer(trimmedText),
			SentAt:      sentAt,
		},
		Media: nil,
		Payload: map[string]any{
			"source":      "whatsmeow",
			"direction":   "outbound",
			"chat_jid":    targetJID.String(),
			"message_id":  messageID,
			"text":        trimmedText,
			"sent_at_utc": sentAt,
		},
	}

	c.emit(Event{
		Type:      EventTypeMessageReceived,
		AccountID: accountID,
		EmittedAt: sentAt,
		Message:   envelope,
	})

	return SendResult{WAMessageID: messageID, SentAt: sentAt}, nil
}

func (c *WhatsmeowConnector) SendMedia(ctx context.Context, accountID, chatJID string, input SendMediaInput) (SendResult, error) {
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

	session, err := c.ensureSession(ctx, accountID)
	if err != nil {
		return SendResult{}, err
	}
	if !session.client.IsConnected() || !session.client.IsLoggedIn() {
		return SendResult{}, fmt.Errorf("whatsapp session is not connected")
	}

	targetJID, err := waTypes.ParseJID(trimmedChat)
	if err != nil {
		return SendResult{}, fmt.Errorf("parse chat jid %q: %w", trimmedChat, err)
	}
	targetJID = targetJID.ToNonAD()

	waMediaType, err := whatsmeowMediaType(mediaType)
	if err != nil {
		return SendResult{}, err
	}

	mimeType := normalizedMIMEType(input.MIMEType, input.Data)
	fileName := strings.TrimSpace(input.FileName)
	caption := strings.TrimSpace(input.Caption)

	upload, err := session.client.Upload(ctx, input.Data, waMediaType)
	if err != nil {
		return SendResult{}, fmt.Errorf("upload whatsapp media: %w", err)
	}

	outboundMessage := buildMediaMessage(mediaType, mimeType, fileName, caption, upload)
	resp, err := session.client.SendMessage(ctx, targetJID, outboundMessage)
	if err != nil {
		return SendResult{}, fmt.Errorf("send whatsapp media message: %w", err)
	}

	sentAt := resp.Timestamp
	if sentAt.IsZero() {
		sentAt = c.now()
	}

	senderJID := resp.Sender.ToNonAD()
	if senderJID.IsEmpty() && session.client.Store != nil && session.client.Store.ID != nil {
		senderJID = session.client.Store.ID.ToNonAD()
	}

	messageID := string(resp.ID)
	media := ingest.MediaInput{
		MediaType:      mediaType,
		MIMEType:       stringPointer(mimeType),
		FileName:       stringPointer(fileName),
		ByteSize:       int64Pointer(int64(len(input.Data))),
		DownloadStatus: ingest.DownloadStatusReady,
	}

	storageKey, checksum, resolvedName, err := storeMediaFile(accountID, messageID, mediaType, stringPointer(mimeType), nil, input.Data)
	if err != nil {
		c.logger.Warn("failed to persist outbound media attachment", "account_id", accountID, "message_id", messageID, "media_type", mediaType, "error", err)
		media.DownloadStatus = ingest.DownloadStatusFailed
	} else {
		media.StorageKey = &storageKey
		media.SHA256 = &checksum
		if media.FileName == nil {
			media.FileName = stringPointer(resolvedName)
		}
	}

	var textContent *string
	if caption != "" && mediaType != ingest.MediaTypeAudio {
		textContent = stringPointer(caption)
	}

	envelope := &MessageEnvelope{
		Chat: ingest.ChatSnapshot{
			AccountID:     accountID,
			WAChatJID:     targetJID.String(),
			ChatType:      mapChatType(targetJID),
			LastMessageAt: &sentAt,
		},
		Contact: nil,
		Message: ingest.MessageInput{
			AccountID:   accountID,
			WAMessageID: messageID,
			SenderJID:   senderJID.String(),
			FromMe:      true,
			MessageType: messageType,
			TextContent: textContent,
			SentAt:      sentAt,
		},
		Media: []ingest.MediaInput{media},
		Payload: map[string]any{
			"source":      "whatsmeow",
			"direction":   "outbound",
			"chat_jid":    targetJID.String(),
			"message_id":  messageID,
			"media_type":  mediaType,
			"mime_type":   mimeType,
			"file_name":   media.FileName,
			"sent_at_utc": sentAt,
		},
	}

	c.emit(Event{
		Type:      EventTypeMessageReceived,
		AccountID: accountID,
		EmittedAt: sentAt,
		Message:   envelope,
	})

	return SendResult{WAMessageID: messageID, SentAt: sentAt}, nil
}

func (c *WhatsmeowConnector) ListSnapshots(_ context.Context) ([]SessionSnapshot, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	items := make([]SessionSnapshot, 0, len(c.sessions))
	for _, session := range c.sessions {
		items = append(items, *cloneSnapshot(session.snapshot))
	}

	sort.Slice(items, func(i, j int) bool {
		return items[i].UpdatedAt.After(items[j].UpdatedAt)
	})

	return items, nil
}

func (c *WhatsmeowConnector) ensureSession(ctx context.Context, accountID string) (*whatsmeowSession, error) {
	c.mu.RLock()
	if session, ok := c.sessions[accountID]; ok && !shouldResetWhatsmeowSession(session) {
		c.mu.RUnlock()
		return session, nil
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	if session, ok := c.sessions[accountID]; ok && !shouldResetWhatsmeowSession(session) {
		return session, nil
	}
	if stale, ok := c.sessions[accountID]; ok {
		if stale.cancelQR != nil {
			stale.cancelQR()
		}
		if stale.client != nil && stale.client.IsConnected() {
			stale.client.Disconnect()
		}
		delete(c.sessions, accountID)
	}

	deviceID, err := c.loadDeviceBinding(ctx, accountID)
	if err != nil {
		return nil, err
	}

	var device *store.Device
	if deviceID != nil && strings.TrimSpace(*deviceID) != "" {
		jid, err := waTypes.ParseJID(*deviceID)
		if err != nil {
			return nil, fmt.Errorf("parse bound device jid for %q: %w", accountID, err)
		}
		device, err = c.container.GetDevice(ctx, jid)
		if err != nil {
			return nil, fmt.Errorf("load bound device for %q: %w", accountID, err)
		}
	}
	if device == nil {
		device = c.container.NewDevice()
	}

	client := whatsmeow.NewClient(device, newWhatsmeowLogger(c.logger.With("account_id", accountID)))
	client.EnableAutoReconnect = true
	if c.proxyURL == "" {
		httpClient := newWhatsmeowHTTPClient()
		client.SetPreLoginHTTPClient(httpClient)
		client.SetWebsocketHTTPClient(httpClient)
		client.SetMediaHTTPClient(httpClient)
	} else if err := client.SetProxyAddress(c.proxyURL); err != nil {
		return nil, fmt.Errorf("configure whatsapp proxy: %w", err)
	}
	client.AddEventHandler(func(evt any) {
		c.handleWhatsmeowEvent(accountID, evt)
	})

	session := &whatsmeowSession{
		accountID: accountID,
		client:    client,
		snapshot: SessionSnapshot{
			AccountID: accountID,
			Status:    "pending",
			UpdatedAt: c.now(),
		},
		catchUpRequested: make(map[string]time.Time),
	}
	if device.ID != nil {
		session.snapshot.Status = "disconnected"
	}

	c.sessions[accountID] = session
	return session, nil
}

func (c *WhatsmeowConnector) connectExistingSession(ctx context.Context, accountID string, session *whatsmeowSession) (SessionSnapshot, error) {
	if session.client.IsConnected() && session.client.IsLoggedIn() {
		return session.snapshot, nil
	}

	snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
		snapshot.Status = "reconnecting"
		snapshot.Pairing = nil
		snapshot.LastError = ""
		snapshot.UpdatedAt = c.now()
		return snapshot
	})
	c.emitSnapshot(snapshot)

	if err := session.client.Connect(); err != nil {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", fmt.Sprintf("connect existing whatsapp session: %v", err))
	}

	return snapshot, nil
}

func (c *WhatsmeowConnector) startQRFlow(accountID string, firstItem whatsmeow.QRChannelItem) (SessionSnapshot, error) {
	if firstItem.Event != whatsmeow.QRChannelEventCode || strings.TrimSpace(firstItem.Code) == "" {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", fmt.Sprintf("unexpected qr event: %s", firstItem.Event))
	}

	snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
		snapshot.Status = "pairing"
		snapshot.Pairing = &PairingArtifact{
			Method:      PairingMethodQR,
			QRCode:      firstItem.Code,
			Instruction: "请用手机 WhatsApp 扫描这个二维码完成绑定。",
			ExpiresAt:   c.now().Add(firstItem.Timeout),
		}
		snapshot.LastError = ""
		snapshot.UpdatedAt = c.now()
		return snapshot
	})
	c.emitSnapshot(snapshot)
	return snapshot, nil
}

func (c *WhatsmeowConnector) startPairingCodeFlow(ctx context.Context, accountID string, session *whatsmeowSession) (SessionSnapshot, error) {
	if c.phoneLookup == nil {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", "pairing_code 需要账号上先填手机号")
	}

	phoneNumber, err := c.phoneLookup.LookupPhone(ctx, accountID)
	if err != nil {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", fmt.Sprintf("load account phone number: %v", err))
	}
	if phoneNumber == nil || strings.TrimSpace(*phoneNumber) == "" {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", "pairing_code 需要账号上先填手机号")
	}

	code, err := session.client.PairPhone(ctx, *phoneNumber, true, whatsmeow.PairClientChrome, "Chrome (Linux)")
	if err != nil {
		return SessionSnapshot{}, c.failSnapshot(accountID, "failed", fmt.Sprintf("generate pairing code: %v", err))
	}

	snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
		snapshot.Status = "pairing"
		snapshot.Pairing = &PairingArtifact{
			Method:      PairingMethodPairingCode,
			PairingCode: code,
			Instruction: "请在手机 WhatsApp 的关联设备界面输入这个配对码。",
			ExpiresAt:   c.now().Add(160 * time.Second),
		}
		snapshot.LastError = ""
		snapshot.UpdatedAt = c.now()
		return snapshot
	})
	c.emitSnapshot(snapshot)
	return snapshot, nil
}

func (c *WhatsmeowConnector) awaitQRItem(ctx context.Context, qrChan <-chan whatsmeow.QRChannelItem) (whatsmeow.QRChannelItem, bool) {
	select {
	case item, ok := <-qrChan:
		return item, ok
	case <-ctx.Done():
		return whatsmeow.QRChannelItem{}, false
	case <-time.After(25 * time.Second):
		return whatsmeow.QRChannelItem{}, false
	}
}

func (c *WhatsmeowConnector) consumeQRChannel(accountID string, qrChan <-chan whatsmeow.QRChannelItem) {
	for item := range qrChan {
		c.handleQRChannelItem(accountID, item)
	}
}

func (c *WhatsmeowConnector) handleQRChannelItem(accountID string, item whatsmeow.QRChannelItem) {
	switch item.Event {
	case whatsmeow.QRChannelEventCode:
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			if snapshot.Pairing != nil && snapshot.Pairing.Method == PairingMethodPairingCode {
				return snapshot
			}
			snapshot.Status = "pairing"
			snapshot.Pairing = &PairingArtifact{
				Method:      PairingMethodQR,
				QRCode:      item.Code,
				Instruction: "二维码已刷新，请重新扫码。",
				ExpiresAt:   c.now().Add(item.Timeout),
			}
			snapshot.LastError = ""
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		c.emitSnapshot(snapshot)
	case whatsmeow.QRChannelSuccess.Event:
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "pairing"
			snapshot.LastError = ""
			if snapshot.Pairing != nil {
				snapshot.Pairing.Instruction = "手机已经确认绑定，等待 WhatsApp 连接完成。"
			}
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		c.emitSnapshot(snapshot)
	case whatsmeow.QRChannelTimeout.Event:
		c.emitSnapshot(c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "disconnected"
			snapshot.Pairing = nil
			snapshot.LastError = "二维码已过期，请重新发起配对"
			snapshot.UpdatedAt = c.now()
			return snapshot
		}))
	case whatsmeow.QRChannelScannedWithoutMultidevice.Event:
		c.emitSnapshot(c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "pairing"
			snapshot.LastError = "手机未开启多设备模式，请在手机上开启后重新扫码"
			snapshot.UpdatedAt = c.now()
			return snapshot
		}))
	case whatsmeow.QRChannelEventError:
		c.failSnapshot(accountID, "failed", fmt.Sprintf("pairing error: %v", item.Error))
	case whatsmeow.QRChannelClientOutdated.Event:
		c.failSnapshot(accountID, "failed", "whatsmeow client version is outdated")
	}
}

func (c *WhatsmeowConnector) handleWhatsmeowEvent(accountID string, evt any) {
	switch event := evt.(type) {
	case *waEvents.Connected:
		now := c.now()
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "connected"
			snapshot.Pairing = nil
			snapshot.LastError = ""
			snapshot.ConnectedAt = &now
			snapshot.UpdatedAt = now
			return snapshot
		})
		c.activateCatchUpWindow(accountID, now)
		c.persistDeviceBinding(context.Background(), accountID)
		c.emitSnapshot(snapshot)
		c.refreshKnownMetadataAsync(accountID)
	case *waEvents.Disconnected:
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			if c.hasPersistedDevice(accountID) {
				snapshot.Status = "reconnecting"
			} else {
				snapshot.Status = "disconnected"
			}
			snapshot.Pairing = nil
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		c.emitSnapshot(snapshot)
	case *waEvents.PairSuccess:
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "pairing"
			snapshot.LastError = ""
			snapshot.Pairing = nil
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		c.persistDeviceBinding(context.Background(), accountID)
		c.emitSnapshot(snapshot)
	case *waEvents.LoggedOut:
		snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "logged_out"
			snapshot.Pairing = nil
			snapshot.LastError = event.Reason.String()
			snapshot.ConnectedAt = nil
			snapshot.UpdatedAt = c.now()
			return snapshot
		})
		if c.bindingStore != nil {
			_ = c.bindingStore.Delete(context.Background(), accountID)
		}
		c.emitSnapshot(snapshot)
	case *waEvents.StreamReplaced:
		c.emitSnapshot(c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "failed"
			snapshot.Pairing = nil
			snapshot.LastError = "该会话被其他客户端顶掉了"
			snapshot.UpdatedAt = c.now()
			return snapshot
		}))
	case *waEvents.QRScannedWithoutMultidevice:
		c.emitSnapshot(c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
			snapshot.Status = "pairing"
			snapshot.LastError = "手机未开启多设备模式，请开启后重新扫码"
			snapshot.UpdatedAt = c.now()
			return snapshot
		}))
	case *waEvents.Message:
		session, found := c.getSession(accountID)
		if !found {
			return
		}
		envelope, err := c.mapIncomingMessage(accountID, session.client, event, nil)
		if err != nil {
			c.logger.Warn("failed to normalize whatsmeow message", "account_id", accountID, "error", err)
			return
		}
		c.emit(Event{
			Type:      EventTypeMessageReceived,
			AccountID: accountID,
			EmittedAt: c.now(),
			Message:   envelope,
		})

		if event.SourceWebMsg == nil && event.UnavailableRequestID == "" {
			c.maybeRequestCatchUpHistory(accountID, session.client, &event.Info)
		}
	case *waEvents.HistorySync:
		if err := c.handleHistorySync(accountID, event); err != nil {
			c.logger.Warn("failed to process history sync", "account_id", accountID, "error", err)
		}
	case *waEvents.UndecryptableMessage:
		c.logger.Warn(
			"received undecryptable whatsapp message; library will retry from primary device",
			"account_id", accountID,
			"chat_jid", event.Info.Chat.String(),
			"message_id", event.Info.ID,
			"is_unavailable", event.IsUnavailable,
		)
	}
}

func (c *WhatsmeowConnector) refreshKnownMetadataAsync(accountID string) {
	if c.db == nil {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), metadataRefreshTimeout)
		defer cancel()

		if err := c.refreshKnownGroupTitles(ctx, accountID); err != nil {
			c.logger.Warn("failed to refresh whatsapp group titles", "account_id", accountID, "error", err)
		}
	}()
}

func (c *WhatsmeowConnector) refreshKnownGroupTitles(ctx context.Context, accountID string) error {
	session, found := c.getSession(accountID)
	if !found || session.client == nil || !session.client.IsConnected() || !session.client.IsLoggedIn() {
		return nil
	}

	const query = `
SELECT wa_chat_jid
FROM chats
WHERE account_id = $1
  AND chat_type = $2
ORDER BY COALESCE(last_message_at, updated_at) DESC
LIMIT 100`

	rows, err := c.db.QueryContext(ctx, query, accountID, ingest.ChatTypeGroup)
	if err != nil {
		return fmt.Errorf("list known group chats: %w", err)
	}
	defer rows.Close()

	groupJIDs := make([]waTypes.JID, 0)
	for rows.Next() {
		var chatJIDText string
		if err := rows.Scan(&chatJIDText); err != nil {
			return fmt.Errorf("scan group chat jid: %w", err)
		}

		chatJID, err := waTypes.ParseJID(strings.TrimSpace(chatJIDText))
		if err != nil {
			c.logger.Warn("failed to parse stored group jid", "account_id", accountID, "jid", chatJIDText, "error", err)
			continue
		}
		groupJIDs = append(groupJIDs, chatJID.ToNonAD())
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate group chats: %w", err)
	}

	for _, groupJID := range groupJIDs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		title, participantCount, err := c.fetchGroupDisplayTitle(ctx, session.client, groupJID)
		if err != nil {
			c.logger.Warn("failed to fetch whatsapp group info", "account_id", accountID, "chat_jid", groupJID.String(), "error", err)
			continue
		}
		if strings.TrimSpace(title) == "" {
			continue
		}

		var participantCountArg any
		if participantCount > 0 {
			participantCountArg = participantCount
		}

		if _, err := c.db.ExecContext(ctx, `
UPDATE chats
SET
    title = $3,
    participant_count = COALESCE($4::integer, participant_count),
    updated_at = NOW()
WHERE account_id = $1
  AND wa_chat_jid = $2`,
			accountID,
			groupJID.String(),
			title,
			participantCountArg,
		); err != nil {
			return fmt.Errorf("update group title for %s: %w", groupJID.String(), err)
		}
	}

	return nil
}

func (c *WhatsmeowConnector) fetchGroupDisplayTitle(ctx context.Context, client *whatsmeow.Client, groupJID waTypes.JID) (string, int, error) {
	requestCtx, cancel := context.WithTimeout(ctx, groupInfoRequestTimeout)
	groupInfo, err := client.GetGroupInfo(requestCtx, groupJID)
	cancel()
	if err != nil {
		return "", 0, err
	}

	title := strings.TrimSpace(groupInfo.Name)
	if parentJID := groupInfo.LinkedParentJID.ToNonAD(); !parentJID.IsEmpty() {
		parentCtx, parentCancel := context.WithTimeout(ctx, groupInfoRequestTimeout)
		parentInfo, parentErr := client.GetGroupInfo(parentCtx, parentJID)
		parentCancel()
		if parentErr == nil {
			parentTitle := strings.TrimSpace(parentInfo.Name)
			switch {
			case parentTitle != "" && title != "" && parentTitle != title:
				title = parentTitle + " / " + title
			case parentTitle != "" && title == "":
				title = parentTitle
			}
		} else {
			c.logger.Warn("failed to fetch whatsapp parent group info", "chat_jid", groupJID.String(), "parent_jid", parentJID.String(), "error", parentErr)
		}
	}

	participantCount := groupInfo.ParticipantCount
	if participantCount <= 0 {
		participantCount = len(groupInfo.Participants)
	}

	return title, participantCount, nil
}

func (c *WhatsmeowConnector) handleHistorySync(accountID string, event *waEvents.HistorySync) error {
	if event == nil || event.Data == nil {
		return nil
	}

	session, found := c.getSession(accountID)
	if !found {
		return fmt.Errorf("history sync received without active session")
	}

	for _, conversation := range event.Data.GetConversations() {
		chatJIDText := strings.TrimSpace(conversation.GetNewJID())
		if chatJIDText == "" {
			chatJIDText = strings.TrimSpace(conversation.GetID())
		}
		if chatJIDText == "" {
			continue
		}

		chatJID, err := waTypes.ParseJID(chatJIDText)
		if err != nil {
			c.logger.Warn("failed to parse history sync chat jid", "account_id", accountID, "jid", chatJIDText, "error", err)
			continue
		}

		meta := &historyChatMeta{
			Title:            firstNonEmptyStringPointer(conversation.GetDisplayName(), conversation.GetName()),
			Archived:         conversation.GetArchived(),
			ParticipantCount: intPointer(len(conversation.GetParticipant())),
		}

		for _, historyMessage := range conversation.GetMessages() {
			webMessage := historyMessage.GetMessage()
			if webMessage == nil {
				continue
			}

			parsed, err := session.client.ParseWebMessage(chatJID, webMessage)
			if err != nil {
				c.logger.Warn("failed to parse history sync message", "account_id", accountID, "chat_jid", chatJID.String(), "error", err)
				continue
			}

			envelope, err := c.mapIncomingMessage(accountID, session.client, parsed, meta)
			if err != nil {
				c.logger.Warn("failed to normalize history sync message", "account_id", accountID, "chat_jid", chatJID.String(), "error", err)
				continue
			}

			c.emit(Event{
				Type:      EventTypeMessageReceived,
				AccountID: accountID,
				EmittedAt: c.now(),
				Message:   envelope,
			})
		}
	}

	return nil
}

func (c *WhatsmeowConnector) mapIncomingMessage(accountID string, client *whatsmeow.Client, event *waEvents.Message, meta *historyChatMeta) (*MessageEnvelope, error) {
	if event == nil || event.Message == nil {
		return nil, fmt.Errorf("message event is empty")
	}

	chatJID := event.Info.Chat.ToNonAD()
	senderJID := event.Info.Sender.ToNonAD()
	now := event.Info.Timestamp
	if now.IsZero() {
		now = c.now()
	}

	messageType, textContent, media := c.extractIncomingMessageContent(accountID, event.Info.ID, client, event.Message)
	payload, err := protojson.Marshal(event.Message)
	if err != nil {
		return nil, fmt.Errorf("marshal incoming whatsapp message: %w", err)
	}

	title := deriveChatTitle(event.Info, textContent)
	archived := false
	var participantCount *int
	if meta != nil {
		if meta.Title != nil {
			title = meta.Title
		}
		archived = meta.Archived
		participantCount = meta.ParticipantCount
	}
	envelope := &MessageEnvelope{
		Chat: ingest.ChatSnapshot{
			AccountID:        accountID,
			WAChatJID:        chatJID.String(),
			ChatType:         mapChatType(chatJID),
			Title:            title,
			ParticipantCount: participantCount,
			Archived:         archived,
			LastMessageAt:    &now,
		},
		Contact: &ingest.ContactSnapshot{
			AccountID:   accountID,
			WAJID:       senderJID.String(),
			DisplayName: deriveDisplayName(event.Info),
			PushName:    derivePushName(event.Info),
			PhoneNumber: derivePhoneNumber(senderJID),
		},
		Message: ingest.MessageInput{
			AccountID:          accountID,
			WAMessageID:        event.Info.ID,
			SenderJID:          senderJID.String(),
			FromMe:             event.Info.IsFromMe,
			MessageType:        messageType,
			TextContent:        textContent,
			ReplyToWAMessageID: extractReplyToMessageID(event.Message),
			SentAt:             now,
		},
		Media: media,
		Payload: map[string]any{
			"message_type": string(messageType),
			"raw_proto":    json.RawMessage(payload),
			"chat_jid":     chatJID.String(),
			"sender_jid":   senderJID.String(),
			"is_from_me":   event.Info.IsFromMe,
		},
	}

	if meta != nil {
		envelope.Payload["source"] = "history_sync"
	} else {
		envelope.Payload["source"] = "whatsmeow"
	}

	if event.Info.IsFromMe {
		envelope.Contact = nil
	}

	return envelope, nil
}

func (c *WhatsmeowConnector) extractIncomingMessageContent(accountID, messageID string, client *whatsmeow.Client, message *waProto.Message) (ingest.MessageType, *string, []ingest.MediaInput) {
	switch {
	case strings.TrimSpace(message.GetConversation()) != "":
		text := strings.TrimSpace(message.GetConversation())
		return ingest.MessageTypeText, stringPointer(text), nil
	case message.GetExtendedTextMessage() != nil:
		text := strings.TrimSpace(message.GetExtendedTextMessage().GetText())
		return ingest.MessageTypeText, stringPointer(text), nil
	case message.GetImageMessage() != nil:
		image := message.GetImageMessage()
		media := c.downloadAndStoreMedia(accountID, messageID, client, ingest.MediaTypeImage, stringPointer(strings.TrimSpace(image.GetMimetype())), nil, int64Pointer(int64(image.GetFileLength())), func(ctx context.Context) ([]byte, error) {
			return client.Download(ctx, image)
		})
		return ingest.MessageTypeImage, stringPointer(strings.TrimSpace(image.GetCaption())), []ingest.MediaInput{media}
	case message.GetVideoMessage() != nil:
		video := message.GetVideoMessage()
		media := c.downloadAndStoreMedia(accountID, messageID, client, ingest.MediaTypeVideo, stringPointer(strings.TrimSpace(video.GetMimetype())), nil, int64Pointer(int64(video.GetFileLength())), func(ctx context.Context) ([]byte, error) {
			return client.Download(ctx, video)
		})
		return ingest.MessageTypeVideo, stringPointer(strings.TrimSpace(video.GetCaption())), []ingest.MediaInput{media}
	case message.GetDocumentMessage() != nil:
		document := message.GetDocumentMessage()
		media := c.downloadAndStoreMedia(accountID, messageID, client, ingest.MediaTypeDocument, stringPointer(strings.TrimSpace(document.GetMimetype())), stringPointer(strings.TrimSpace(document.GetFileName())), int64Pointer(int64(document.GetFileLength())), func(ctx context.Context) ([]byte, error) {
			return client.Download(ctx, document)
		})
		return ingest.MessageTypeDocument, stringPointer(strings.TrimSpace(document.GetCaption())), []ingest.MediaInput{media}
	case message.GetAudioMessage() != nil:
		audio := message.GetAudioMessage()
		media := c.downloadAndStoreMedia(accountID, messageID, client, ingest.MediaTypeAudio, stringPointer(strings.TrimSpace(audio.GetMimetype())), nil, int64Pointer(int64(audio.GetFileLength())), func(ctx context.Context) ([]byte, error) {
			return client.Download(ctx, audio)
		})
		return ingest.MessageTypeAudio, nil, []ingest.MediaInput{media}
	case message.GetStickerMessage() != nil:
		sticker := message.GetStickerMessage()
		media := c.downloadAndStoreMedia(accountID, messageID, client, ingest.MediaTypeSticker, stringPointer(strings.TrimSpace(sticker.GetMimetype())), nil, int64Pointer(int64(sticker.GetFileLength())), func(ctx context.Context) ([]byte, error) {
			return client.Download(ctx, sticker)
		})
		return ingest.MessageTypeSticker, nil, []ingest.MediaInput{media}
	case message.GetReactionMessage() != nil:
		reaction := strings.TrimSpace(message.GetReactionMessage().GetText())
		return ingest.MessageTypeReaction, stringPointer(reaction), nil
	case message.GetProtocolMessage() != nil:
		text := fmt.Sprintf("protocol:%s", message.GetProtocolMessage().GetType().String())
		return ingest.MessageTypeSystem, stringPointer(text), nil
	default:
		return ingest.MessageTypeUnknown, nil, nil
	}
}

func (c *WhatsmeowConnector) downloadAndStoreMedia(
	accountID string,
	messageID string,
	client *whatsmeow.Client,
	mediaType ingest.MediaType,
	mimeType *string,
	fileName *string,
	byteSize *int64,
	download func(ctx context.Context) ([]byte, error),
) ingest.MediaInput {
	item := ingest.MediaInput{
		MediaType:      mediaType,
		MIMEType:       mimeType,
		FileName:       fileName,
		ByteSize:       byteSize,
		DownloadStatus: ingest.DownloadStatusPending,
	}
	if client == nil {
		item.DownloadStatus = ingest.DownloadStatusFailed
		return item
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()

	data, err := download(ctx)
	if err != nil {
		c.logger.Warn("failed to download media attachment", "account_id", accountID, "message_id", messageID, "media_type", mediaType, "error", err)
		item.DownloadStatus = ingest.DownloadStatusFailed
		return item
	}

	storageKey, checksum, resolvedName, err := storeMediaFile(accountID, messageID, mediaType, mimeType, fileName, data)
	if err != nil {
		c.logger.Warn("failed to persist media attachment", "account_id", accountID, "message_id", messageID, "media_type", mediaType, "error", err)
		item.DownloadStatus = ingest.DownloadStatusFailed
		return item
	}

	item.StorageKey = &storageKey
	item.SHA256 = &checksum
	item.FileName = &resolvedName
	item.DownloadStatus = ingest.DownloadStatusReady
	return item
}

func normalizeOutgoingMediaType(mediaType ingest.MediaType) (ingest.MediaType, ingest.MessageType, error) {
	switch ingest.MediaType(strings.ToLower(strings.TrimSpace(string(mediaType)))) {
	case ingest.MediaTypeImage:
		return ingest.MediaTypeImage, ingest.MessageTypeImage, nil
	case ingest.MediaTypeVideo:
		return ingest.MediaTypeVideo, ingest.MessageTypeVideo, nil
	case ingest.MediaTypeAudio:
		return ingest.MediaTypeAudio, ingest.MessageTypeAudio, nil
	case ingest.MediaTypeDocument, "", ingest.MediaTypeOther:
		return ingest.MediaTypeDocument, ingest.MessageTypeDocument, nil
	default:
		return "", "", fmt.Errorf("unsupported media_type %q", mediaType)
	}
}

func whatsmeowMediaType(mediaType ingest.MediaType) (whatsmeow.MediaType, error) {
	switch mediaType {
	case ingest.MediaTypeImage:
		return whatsmeow.MediaImage, nil
	case ingest.MediaTypeVideo:
		return whatsmeow.MediaVideo, nil
	case ingest.MediaTypeAudio:
		return whatsmeow.MediaAudio, nil
	case ingest.MediaTypeDocument:
		return whatsmeow.MediaDocument, nil
	default:
		return "", fmt.Errorf("unsupported media_type %q", mediaType)
	}
}

func buildMediaMessage(mediaType ingest.MediaType, mimeType, fileName, caption string, upload whatsmeow.UploadResponse) *waProto.Message {
	fileLength := upload.FileLength
	baseURL := upload.URL
	directPath := upload.DirectPath

	switch mediaType {
	case ingest.MediaTypeImage:
		image := &waProto.ImageMessage{
			URL:           &baseURL,
			DirectPath:    &directPath,
			MediaKey:      upload.MediaKey,
			Mimetype:      proto.String(mimeType),
			FileSHA256:    upload.FileSHA256,
			FileEncSHA256: upload.FileEncSHA256,
			FileLength:    &fileLength,
		}
		if strings.TrimSpace(caption) != "" {
			image.Caption = proto.String(strings.TrimSpace(caption))
		}
		return &waProto.Message{ImageMessage: image}
	case ingest.MediaTypeVideo:
		video := &waProto.VideoMessage{
			URL:           &baseURL,
			DirectPath:    &directPath,
			MediaKey:      upload.MediaKey,
			Mimetype:      proto.String(mimeType),
			FileSHA256:    upload.FileSHA256,
			FileEncSHA256: upload.FileEncSHA256,
			FileLength:    &fileLength,
		}
		if strings.TrimSpace(caption) != "" {
			video.Caption = proto.String(strings.TrimSpace(caption))
		}
		return &waProto.Message{VideoMessage: video}
	case ingest.MediaTypeAudio:
		return &waProto.Message{
			AudioMessage: &waProto.AudioMessage{
				URL:           &baseURL,
				DirectPath:    &directPath,
				MediaKey:      upload.MediaKey,
				Mimetype:      proto.String(mimeType),
				FileSHA256:    upload.FileSHA256,
				FileEncSHA256: upload.FileEncSHA256,
				FileLength:    &fileLength,
				PTT:           proto.Bool(false),
			},
		}
	default:
		resolvedName := strings.TrimSpace(fileName)
		if resolvedName == "" {
			resolvedName = "document"
		}
		document := &waProto.DocumentMessage{
			URL:           &baseURL,
			DirectPath:    &directPath,
			MediaKey:      upload.MediaKey,
			Mimetype:      proto.String(mimeType),
			FileSHA256:    upload.FileSHA256,
			FileEncSHA256: upload.FileEncSHA256,
			FileLength:    &fileLength,
			FileName:      proto.String(resolvedName),
			Title:         proto.String(resolvedName),
		}
		if strings.TrimSpace(caption) != "" {
			document.Caption = proto.String(strings.TrimSpace(caption))
		}
		return &waProto.Message{DocumentMessage: document}
	}
}

func normalizedMIMEType(value string, data []byte) string {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		return trimmed
	}
	if len(data) > 0 {
		return http.DetectContentType(data)
	}
	return "application/octet-stream"
}

func extractReplyToMessageID(message *waProto.Message) *string {
	switch {
	case message.GetExtendedTextMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetExtendedTextMessage().GetContextInfo().GetStanzaID()))
	case message.GetImageMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetImageMessage().GetContextInfo().GetStanzaID()))
	case message.GetVideoMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetVideoMessage().GetContextInfo().GetStanzaID()))
	case message.GetDocumentMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetDocumentMessage().GetContextInfo().GetStanzaID()))
	case message.GetAudioMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetAudioMessage().GetContextInfo().GetStanzaID()))
	case message.GetStickerMessage() != nil:
		return stringPointer(strings.TrimSpace(message.GetStickerMessage().GetContextInfo().GetStanzaID()))
	default:
		return nil
	}
}

func mapChatType(jid waTypes.JID) ingest.ChatType {
	switch jid.Server {
	case waTypes.GroupServer:
		return ingest.ChatTypeGroup
	case waTypes.BroadcastServer:
		if jid.User == waTypes.StatusBroadcastJID.User {
			return ingest.ChatTypeStatus
		}
		return ingest.ChatTypeBroadcast
	default:
		return ingest.ChatTypeDirect
	}
}

func deriveChatTitle(info waTypes.MessageInfo, _ *string) *string {
	switch mapChatType(info.Chat.ToNonAD()) {
	case ingest.ChatTypeDirect:
		if strings.TrimSpace(info.PushName) != "" {
			return stringPointer(info.PushName)
		}
		if !info.Sender.IsEmpty() {
			return stringPointer(info.Sender.ToNonAD().User)
		}
	}

	return nil
}

func deriveDisplayName(info waTypes.MessageInfo) *string {
	if strings.TrimSpace(info.PushName) == "" {
		return nil
	}
	return stringPointer(info.PushName)
}

func derivePushName(info waTypes.MessageInfo) *string {
	if strings.TrimSpace(info.PushName) == "" {
		return nil
	}
	return stringPointer(info.PushName)
}

func derivePhoneNumber(jid waTypes.JID) *string {
	if jid.Server != waTypes.DefaultUserServer && jid.Server != waTypes.HiddenUserServer {
		return nil
	}
	return stringPointer(jid.User)
}

func int64Pointer(value int64) *int64 {
	if value <= 0 {
		return nil
	}

	result := value
	return &result
}

func intPointer(value int) *int {
	if value <= 0 {
		return nil
	}

	result := value
	return &result
}

func firstNonEmptyStringPointer(values ...string) *string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return stringPointer(trimmed)
		}
	}

	return nil
}

func newWhatsmeowHTTPClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	dialer := &net.Dialer{
		Timeout:   30 * time.Second,
		KeepAlive: 30 * time.Second,
	}

	transport.DialContext = func(ctx context.Context, _, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return dialer.DialContext(ctx, "tcp4", address)
		}

		if parsedIP := net.ParseIP(host); parsedIP != nil {
			if parsedIP.To4() != nil {
				return dialer.DialContext(ctx, "tcp4", address)
			}
			return dialer.DialContext(ctx, "tcp", address)
		}

		lookupCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()

		addresses, err := net.DefaultResolver.LookupIPAddr(lookupCtx, host)
		if err == nil {
			for _, candidate := range addresses {
				if ipv4 := candidate.IP.To4(); ipv4 != nil {
					return dialer.DialContext(ctx, "tcp4", net.JoinHostPort(ipv4.String(), port))
				}
			}
		}

		return dialer.DialContext(ctx, "tcp", address)
	}

	return &http.Client{
		Transport: transport,
		Timeout:   45 * time.Second,
	}
}

func (c *WhatsmeowConnector) loadDeviceBinding(ctx context.Context, accountID string) (*string, error) {
	if c.bindingStore == nil {
		return nil, nil
	}

	deviceID, err := c.bindingStore.LoadDeviceBinding(ctx, accountID)
	if err != nil {
		if strings.Contains(err.Error(), "sql: no rows in result set") {
			return nil, nil
		}
		return nil, err
	}
	if deviceID == nil || strings.TrimSpace(*deviceID) == "" {
		return nil, nil
	}

	return deviceID, nil
}

func (c *WhatsmeowConnector) persistDeviceBinding(ctx context.Context, accountID string) {
	if c.bindingStore == nil {
		return
	}

	session, found := c.getSession(accountID)
	if !found || session.client.Store == nil || session.client.Store.ID == nil {
		return
	}

	deviceID := session.client.Store.ID.String()
	if err := c.bindingStore.SaveDeviceBinding(ctx, accountID, &deviceID); err != nil {
		c.logger.Warn("failed to persist whatsmeow device binding", "account_id", accountID, "error", err)
	}
}

func (c *WhatsmeowConnector) hasPersistedDevice(accountID string) bool {
	session, found := c.getSession(accountID)
	return found && session.client.Store != nil && session.client.Store.ID != nil
}

func (c *WhatsmeowConnector) activateCatchUpWindow(accountID string, connectedAt time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()

	session, ok := c.sessions[accountID]
	if !ok {
		return
	}

	session.catchUpUntil = connectedAt.Add(catchUpWindow)
	session.catchUpRequested = make(map[string]time.Time)
}

func (c *WhatsmeowConnector) maybeRequestCatchUpHistory(accountID string, client *whatsmeow.Client, info *waTypes.MessageInfo) {
	if client == nil || info == nil || info.Chat.IsEmpty() || strings.TrimSpace(info.ID) == "" {
		return
	}

	chatJID := info.Chat.ToNonAD()
	if !c.reserveCatchUpRequest(accountID, chatJID.String()) {
		return
	}

	go func(infoCopy waTypes.MessageInfo) {
		ctx, cancel := context.WithTimeout(context.Background(), catchUpRequestTimeout)
		defer cancel()

		_, err := client.SendPeerMessage(ctx, client.BuildHistorySyncRequest(&infoCopy, catchUpMessageCount))
		if err != nil {
			c.releaseCatchUpRequest(accountID, chatJID.String())
			c.logger.Warn(
				"failed to request catch-up history",
				"account_id", accountID,
				"chat_jid", chatJID.String(),
				"anchor_message_id", infoCopy.ID,
				"error", err,
			)
			return
		}

		c.logger.Info(
			"requested catch-up history after reconnect",
			"account_id", accountID,
			"chat_jid", chatJID.String(),
			"anchor_message_id", infoCopy.ID,
			"count", catchUpMessageCount,
		)
	}(*info)
}

func (c *WhatsmeowConnector) reserveCatchUpRequest(accountID, chatJID string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()

	session, ok := c.sessions[accountID]
	if !ok {
		return false
	}
	if session.catchUpUntil.IsZero() || c.now().After(session.catchUpUntil) {
		return false
	}
	if len(session.catchUpRequested) >= catchUpChatRequestLimit {
		return false
	}
	if _, exists := session.catchUpRequested[chatJID]; exists {
		return false
	}

	session.catchUpRequested[chatJID] = c.now()
	return true
}

func (c *WhatsmeowConnector) releaseCatchUpRequest(accountID, chatJID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	session, ok := c.sessions[accountID]
	if !ok {
		return
	}

	delete(session.catchUpRequested, chatJID)
}

func (c *WhatsmeowConnector) getSession(accountID string) (*whatsmeowSession, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	session, ok := c.sessions[accountID]
	return session, ok
}

func (c *WhatsmeowConnector) removeSession(accountID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.sessions, accountID)
}

func (c *WhatsmeowConnector) setSnapshot(accountID string, snapshot SessionSnapshot) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if session, ok := c.sessions[accountID]; ok {
		session.snapshot = snapshot
	}
}

func (c *WhatsmeowConnector) updateSnapshot(accountID string, update func(SessionSnapshot) SessionSnapshot) SessionSnapshot {
	c.mu.Lock()
	defer c.mu.Unlock()

	session, ok := c.sessions[accountID]
	if !ok {
		return SessionSnapshot{
			AccountID: accountID,
			Status:    "failed",
			UpdatedAt: c.now(),
		}
	}

	session.snapshot = update(session.snapshot)
	return session.snapshot
}

func (c *WhatsmeowConnector) failSnapshot(accountID, status, message string) error {
	snapshot := c.updateSnapshot(accountID, func(snapshot SessionSnapshot) SessionSnapshot {
		snapshot.Status = status
		snapshot.Pairing = nil
		snapshot.LastError = message
		snapshot.UpdatedAt = c.now()
		return snapshot
	})
	c.emitSnapshot(snapshot)
	return fmt.Errorf("%s", message)
}

func (c *WhatsmeowConnector) emitSnapshot(snapshot SessionSnapshot) {
	c.emit(Event{
		Type:      EventTypeSessionSnapshot,
		AccountID: snapshot.AccountID,
		Snapshot:  cloneSnapshot(snapshot),
		EmittedAt: snapshot.UpdatedAt,
	})
}

func (c *WhatsmeowConnector) emit(event Event) {
	c.mu.RLock()
	handler := c.handler
	c.mu.RUnlock()

	if handler != nil {
		handler(event)
	}
}

func storeMediaFile(accountID, messageID string, mediaType ingest.MediaType, mimeType *string, fileName *string, data []byte) (string, string, string, error) {
	if len(data) == 0 {
		return "", "", "", fmt.Errorf("media payload is empty")
	}

	baseDir := filepath.Join("data", "media", sanitizePathSegment(accountID))
	if err := os.MkdirAll(baseDir, 0o755); err != nil {
		return "", "", "", fmt.Errorf("create media dir: %w", err)
	}

	resolvedName := resolveMediaFileName(messageID, mediaType, mimeType, fileName)
	fullPath := filepath.Join(baseDir, resolvedName)
	if err := os.WriteFile(fullPath, data, 0o644); err != nil {
		return "", "", "", fmt.Errorf("write media file: %w", err)
	}

	sum := sha256.Sum256(data)
	relativePath := filepath.ToSlash(fullPath)
	return relativePath, fmt.Sprintf("%x", sum[:]), resolvedName, nil
}

func resolveMediaFileName(messageID string, mediaType ingest.MediaType, mimeType *string, fileName *string) string {
	if fileName != nil && strings.TrimSpace(*fileName) != "" {
		return sanitizeFileName(*fileName)
	}

	ext := ".bin"
	if mimeType != nil && strings.TrimSpace(*mimeType) != "" {
		if candidates, err := mime.ExtensionsByType(*mimeType); err == nil && len(candidates) > 0 {
			ext = candidates[0]
		}
	}
	if mediaType == ingest.MediaTypeSticker && ext == ".bin" {
		ext = ".webp"
	}

	return fmt.Sprintf("%s-%s%s", sanitizePathSegment(messageID), mediaType, ext)
}

func sanitizeFileName(value string) string {
	replacer := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_")
	cleaned := strings.TrimSpace(replacer.Replace(value))
	if cleaned == "" {
		return "file.bin"
	}
	return cleaned
}

func sanitizePathSegment(value string) string {
	replacer := strings.NewReplacer("\\", "_", "/", "_", ":", "_", "*", "_", "?", "_", "\"", "_", "<", "_", ">", "_", "|", "_", "@", "_")
	cleaned := strings.TrimSpace(replacer.Replace(value))
	if cleaned == "" {
		return "unknown"
	}
	return cleaned
}

func shouldResetWhatsmeowSession(session *whatsmeowSession) bool {
	return session == nil || session.client == nil || session.client.Store == nil || session.client.Store.Deleted
}
