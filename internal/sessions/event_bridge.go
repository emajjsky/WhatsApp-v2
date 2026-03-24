package sessions

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"whatsapp-agent-platform/internal/ingest"
)

type EventType string

const (
	EventTypeSessionSnapshot EventType = "session.snapshot"
	EventTypeMessageReceived EventType = "message.received"
)

type Event struct {
	Type      EventType        `json:"type"`
	AccountID string           `json:"account_id"`
	Snapshot  *SessionSnapshot `json:"snapshot,omitempty"`
	Message   *MessageEnvelope `json:"message,omitempty"`
	EmittedAt time.Time        `json:"emitted_at"`
}

type MessageEnvelope struct {
	Chat    ingest.ChatSnapshot    `json:"chat"`
	Contact *ingest.ContactSnapshot `json:"contact,omitempty"`
	Message ingest.MessageInput    `json:"message"`
	Media   []ingest.MediaInput    `json:"media,omitempty"`
	Payload map[string]any         `json:"payload,omitempty"`
}

type LiveUpdateType string

const (
	LiveUpdateSessionChanged LiveUpdateType = "session_changed"
	LiveUpdateMessageStored  LiveUpdateType = "message_stored"
)

type LiveUpdate struct {
	Type       LiveUpdateType `json:"type"`
	AccountID  string         `json:"account_id"`
	Status     string         `json:"status,omitempty"`
	ChatID     string         `json:"chat_id,omitempty"`
	MessageID  string         `json:"message_id,omitempty"`
	OccurredAt time.Time      `json:"occurred_at"`
	Summary    string         `json:"summary"`
}

type IngestSink interface {
	PersistEvent(ctx context.Context, event ingest.RawEvent) (ingest.PersistResult, error)
}

type AccountStatusUpdater interface {
	UpdateStatus(ctx context.Context, id, status string, lastSeenAt *time.Time) error
}

type EventBridge struct {
	ingestSink    IngestSink
	accountStatus AccountStatusUpdater
	logger        *slog.Logger

	mu          sync.RWMutex
	subscribers map[chan LiveUpdate]struct{}
}

func NewEventBridge(ingestSink IngestSink, accountStatus AccountStatusUpdater, logger *slog.Logger) *EventBridge {
	if logger == nil {
		logger = slog.Default()
	}

	return &EventBridge{
		ingestSink:    ingestSink,
		accountStatus: accountStatus,
		logger:        logger.With("component", "session_event_bridge"),
		subscribers:   make(map[chan LiveUpdate]struct{}),
	}
}

func (b *EventBridge) Handle(ctx context.Context, event Event) error {
	if event.EmittedAt.IsZero() {
		event.EmittedAt = time.Now().UTC()
	}

	switch event.Type {
	case EventTypeSessionSnapshot:
		return b.handleSessionSnapshot(ctx, event)
	case EventTypeMessageReceived:
		return b.handleMessageReceived(ctx, event)
	default:
		return fmt.Errorf("unsupported session event type %q", event.Type)
	}
}

func (b *EventBridge) Subscribe(buffer int) (<-chan LiveUpdate, func()) {
	if buffer <= 0 {
		buffer = 8
	}

	ch := make(chan LiveUpdate, buffer)

	b.mu.Lock()
	b.subscribers[ch] = struct{}{}
	b.mu.Unlock()

	cancel := func() {
		b.mu.Lock()
		if _, ok := b.subscribers[ch]; ok {
			delete(b.subscribers, ch)
			close(ch)
		}
		b.mu.Unlock()
	}

	return ch, cancel
}

func (b *EventBridge) handleSessionSnapshot(ctx context.Context, event Event) error {
	if event.Snapshot == nil {
		return fmt.Errorf("session snapshot event requires snapshot payload")
	}

	lastSeenAt := event.Snapshot.ConnectedAt
	if event.Snapshot.Status == "connected" && lastSeenAt == nil {
		lastSeenAt = &event.Snapshot.UpdatedAt
	}

	if b.accountStatus != nil {
		if err := b.accountStatus.UpdateStatus(ctx, event.AccountID, event.Snapshot.Status, lastSeenAt); err != nil {
			return fmt.Errorf("sync account status for %q: %w", event.AccountID, err)
		}
	}

	b.publish(LiveUpdate{
		Type:       LiveUpdateSessionChanged,
		AccountID:  event.AccountID,
		Status:     event.Snapshot.Status,
		OccurredAt: event.EmittedAt,
		Summary:    fmt.Sprintf("Session status changed to %s", event.Snapshot.Status),
	})

	return nil
}

func (b *EventBridge) handleMessageReceived(ctx context.Context, event Event) error {
	if event.Message == nil {
		return fmt.Errorf("message event requires message payload")
	}
	if b.ingestSink == nil {
		return fmt.Errorf("message event bridge requires an ingest sink")
	}

	result, err := b.ingestSink.PersistEvent(ctx, ingest.RawEvent{
		AccountID: event.AccountID,
		Chat:      event.Message.Chat,
		Contact:   event.Message.Contact,
		Message:   event.Message.Message,
		Media:     event.Message.Media,
		Payload:   event.Message.Payload,
	})
	if err != nil {
		return fmt.Errorf("persist live message for %q: %w", event.AccountID, err)
	}

	if b.accountStatus != nil {
		lastSeenAt := event.Message.Message.SentAt
		if lastSeenAt.IsZero() {
			lastSeenAt = event.EmittedAt
		}
		if err := b.accountStatus.UpdateStatus(ctx, event.AccountID, "connected", &lastSeenAt); err != nil {
			return fmt.Errorf("update account last_seen_at for %q: %w", event.AccountID, err)
		}
	}

	b.publish(LiveUpdate{
		Type:       LiveUpdateMessageStored,
		AccountID:  event.AccountID,
		Status:     "connected",
		ChatID:     result.ChatID,
		MessageID:  result.MessageID,
		OccurredAt: event.EmittedAt,
		Summary:    summarizeMessage(event.Message.Message.TextContent),
	})

	b.logger.Info(
		"live session event persisted",
		"account_id", event.AccountID,
		"chat_id", result.ChatID,
		"message_id", result.MessageID,
		"media_count", result.MediaCount,
	)

	return nil
}

func (b *EventBridge) publish(update LiveUpdate) {
	b.mu.RLock()
	defer b.mu.RUnlock()

	for subscriber := range b.subscribers {
		select {
		case subscriber <- update:
		default:
		}
	}
}

func summarizeMessage(text *string) string {
	if text == nil {
		return "Live message stored"
	}

	trimmed := strings.TrimSpace(*text)
	if trimmed == "" {
		return "Live message stored"
	}
	if len(trimmed) > 72 {
		return trimmed[:72] + "..."
	}

	return trimmed
}
