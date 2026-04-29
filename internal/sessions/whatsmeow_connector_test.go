package sessions

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	waHistorySync "go.mau.fi/whatsmeow/proto/waHistorySync"
	"go.mau.fi/whatsmeow/store"
	waTypes "go.mau.fi/whatsmeow/types"
	waEvents "go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestDisconnectedEventDoesNotDeadlock(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")

	done := make(chan struct{})
	go func() {
		connector.handleWhatsmeowEvent(accountID, &waEvents.Disconnected{})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("disconnected event deadlocked")
	}

	snapshot, err := connector.Status(context.Background(), accountID)
	if err != nil {
		t.Fatalf("status returned error: %v", err)
	}
	if snapshot.Status != "reconnecting" {
		t.Fatalf("status = %q, want reconnecting", snapshot.Status)
	}
}

func TestStatusReconcilesStaleConnectedSnapshot(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")

	snapshot, err := connector.Status(context.Background(), accountID)
	if err != nil {
		t.Fatalf("status returned error: %v", err)
	}
	if snapshot.Status != "reconnecting" {
		t.Fatalf("status = %q, want reconnecting", snapshot.Status)
	}
}

func TestHistorySyncEmitsChatSnapshotForEmptyConversation(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")

	events := make([]Event, 0, 1)
	connector.SetEventHandler(func(event Event) {
		events = append(events, event)
	})

	err := connector.handleHistorySync(accountID, &waEvents.HistorySync{
		Data: &waHistorySync.HistorySync{
			Conversations: []*waHistorySync.Conversation{
				{
					ID:               proto.String("120363000000000000@g.us"),
					DisplayName:      proto.String("Sales Team"),
					Archived:         proto.Bool(true),
					LastMsgTimestamp: proto.Uint64(1700000123),
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("handleHistorySync returned error: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}

	event := events[0]
	if event.Type != EventTypeChatSnapshot {
		t.Fatalf("event.Type = %q, want %q", event.Type, EventTypeChatSnapshot)
	}
	if event.Chat == nil {
		t.Fatal("event.Chat is nil")
	}
	if event.Chat.WAChatJID != "120363000000000000@g.us" {
		t.Fatalf("WAChatJID = %q, want group jid", event.Chat.WAChatJID)
	}
	if event.Chat.ChatType != "group" {
		t.Fatalf("ChatType = %q, want group", event.Chat.ChatType)
	}
	if event.Chat.Title == nil || *event.Chat.Title != "Sales Team" {
		t.Fatalf("Title = %v, want Sales Team", event.Chat.Title)
	}
	if !event.Chat.Archived {
		t.Fatal("Archived = false, want true")
	}
	if event.Chat.LastMessageAt == nil || !event.Chat.LastMessageAt.Equal(time.Unix(1700000123, 0).UTC()) {
		t.Fatalf("LastMessageAt = %v, want 1700000123", event.Chat.LastMessageAt)
	}
}

func TestHistoryConversationLastMessageAtFallsBackToConversationTimestamp(t *testing.T) {
	conversation := &waHistorySync.Conversation{
		ConversationTimestamp: proto.Uint64(1700000456),
	}

	lastMessageAt := historyConversationLastMessageAt(conversation)
	if lastMessageAt == nil {
		t.Fatal("lastMessageAt is nil")
	}
	if !lastMessageAt.Equal(time.Unix(1700000456, 0).UTC()) {
		t.Fatalf("lastMessageAt = %v, want conversation timestamp", lastMessageAt)
	}
}

func newTestWhatsmeowConnector(accountID, status string) *WhatsmeowConnector {
	jid := waTypes.NewJID("15551234567", waTypes.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{ID: &jid}, nil)
	now := time.Unix(1700000000, 0).UTC()

	return &WhatsmeowConnector{
		logger: slog.Default(),
		now:    func() time.Time { return now },
		sessions: map[string]*whatsmeowSession{
			accountID: {
				accountID: accountID,
				client:    client,
				snapshot: SessionSnapshot{
					AccountID: accountID,
					Status:    status,
					UpdatedAt: now,
				},
			},
		},
	}
}
