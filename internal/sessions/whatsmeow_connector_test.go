package sessions

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/store"
	waTypes "go.mau.fi/whatsmeow/types"
	waEvents "go.mau.fi/whatsmeow/types/events"
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
