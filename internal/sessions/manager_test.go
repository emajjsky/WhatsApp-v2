package sessions

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"whatsapp-agent-platform/internal/ingest"
)

type testIngestSink struct {
	started    chan struct{}
	continueCh chan struct{}
}

func (s *testIngestSink) PersistChat(context.Context, ingest.ChatSnapshot) (ingest.ChatPersistResult, error) {
	return ingest.ChatPersistResult{ChatID: "chat-1"}, nil
}

func (s *testIngestSink) PersistEvent(_ context.Context, event ingest.RawEvent) (ingest.PersistResult, error) {
	if s.started != nil {
		select {
		case s.started <- struct{}{}:
		default:
		}
	}
	if s.continueCh != nil {
		<-s.continueCh
	}
	return ingest.PersistResult{ChatID: "chat-1", MessageID: event.Message.WAMessageID}, nil
}

func (s *testIngestSink) UpdateStatus(context.Context, string, string, *time.Time) error {
	return nil
}

func TestManagerPersistsBeforePublishingAndKeepsOrder(t *testing.T) {
	sink := &testIngestSink{
		started:    make(chan struct{}, 1),
		continueCh: make(chan struct{}),
	}
	bridge := NewEventBridge(sink, sink, slog.Default())
	manager := NewManager(nil, nil, slog.Default())
	manager.SetEventBridge(bridge)
	updates, cancel := manager.Subscribe(2)
	defer cancel()

	manager.handleEvent(testMessageEvent("m-1"))
	select {
	case <-sink.started:
	case <-time.After(time.Second):
		t.Fatal("bridge did not start processing")
	}
	select {
	case <-updates:
		t.Fatal("event must not be published before persistence completes")
	default:
	}

	manager.handleEvent(testMessageEvent("m-2"))
	close(sink.continueCh)

	select {
	case first := <-updates:
		if first.Message == nil || first.Message.Message.WAMessageID != "m-1" {
			t.Fatalf("first published event = %#v, want m-1", first.Message)
		}
	case <-time.After(time.Second):
		t.Fatal("first event was not published")
	}
	select {
	case second := <-updates:
		if second.Message == nil || second.Message.Message.WAMessageID != "m-2" {
			t.Fatalf("second published event = %#v, want m-2", second.Message)
		}
	case <-time.After(time.Second):
		t.Fatal("second event was not published")
	}
}

func testMessageEvent(messageID string) Event {
	return Event{
		Type:      EventTypeMessageReceived,
		AccountID: "account-1",
		Message: &MessageEnvelope{
			Chat: ingest.ChatSnapshot{WAChatJID: "customer@s.whatsapp.net"},
			Message: ingest.MessageInput{
				WAMessageID: messageID,
				MessageType: ingest.MessageTypeText,
				TextContent: stringPointer("hello"),
			},
		},
	}
}
