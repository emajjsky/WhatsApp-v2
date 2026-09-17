package sessions

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"whatsapp-agent-platform/internal/ingest"

	"go.mau.fi/whatsmeow"
	waBinary "go.mau.fi/whatsmeow/binary"
	waProto "go.mau.fi/whatsmeow/proto/waE2E"
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

func TestDisconnectedEventDoesNotOverrideLoggedOutState(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "logged_out")
	events := make([]Event, 0, 1)
	connector.SetEventHandler(func(event Event) { events = append(events, event) })

	connector.handleWhatsmeowEvent(accountID, &waEvents.Disconnected{})

	_, snapshot, found := connector.getSessionState(accountID)
	if !found {
		t.Fatal("session unexpectedly removed")
	}
	if snapshot.Status != "logged_out" {
		t.Fatalf("status = %q, want logged_out", snapshot.Status)
	}
	if len(events) != 0 {
		t.Fatalf("events = %d, want no reconnecting event", len(events))
	}
}

func TestHandleSendFailureLogsOutUnauthorizedSession(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")
	connector.sessions[accountID].client = nil
	events := make([]Event, 0, 1)
	connector.SetEventHandler(func(event Event) { events = append(events, event) })

	err := connector.handleSendFailure(accountID, "send whatsapp message", errors.New("status 401: not-authorized"))

	if err == nil || !strings.Contains(err.Error(), "WhatsApp 登录已失效") {
		t.Fatalf("error = %v, want login expired message", err)
	}
	if _, found := connector.getSession(accountID); found {
		t.Fatal("unauthorized session was not removed")
	}
	if len(events) != 1 || events[0].Snapshot == nil || events[0].Snapshot.Status != "logged_out" {
		t.Fatalf("events = %#v, want one logged_out snapshot", events)
	}
}

func TestLateSessionEventIsIgnoredAfterSessionRemoval(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")
	connector.removeSession(accountID)
	events := make([]Event, 0, 1)
	connector.SetEventHandler(func(event Event) { events = append(events, event) })

	connector.handleWhatsmeowEvent(accountID, &waEvents.Connected{})
	connector.handleWhatsmeowEvent(accountID, &waEvents.LoggedOut{})

	if len(events) != 0 {
		t.Fatalf("events = %#v, want late events to be ignored", events)
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

func TestInternalProtocolMessagesAreIgnored(t *testing.T) {
	protocolText := "protocol:HISTORY_SYNC_NOTIFICATION"
	if !shouldIgnoreInboundMessage(ingest.MessageTypeSystem, &protocolText) {
		t.Fatal("internal protocol message should be ignored")
	}

	customerText := "protocol:客户自己发送的普通文本"
	if shouldIgnoreInboundMessage(ingest.MessageTypeText, &customerText) {
		t.Fatal("customer text should not be ignored")
	}
}

func TestInternalProtocolPayloadIsDetectedBeforeChatCreation(t *testing.T) {
	if !isInternalProtocolMessage(&waProto.Message{ProtocolMessage: &waProto.ProtocolMessage{}}) {
		t.Fatal("protocol payload should be detected")
	}
	if isInternalProtocolMessage(&waProto.Message{Conversation: proto.String("hello")}) {
		t.Fatal("customer text payload should not be detected as protocol")
	}
}

func TestContactAndPollPayloadNormalization(t *testing.T) {
	if got := sanitizeVCardText("Alice\r\nTEL:123,Sales"); got != "Alice TEL:123\\,Sales" {
		t.Fatalf("sanitizeVCardText() = %q", got)
	}
	if got := normalizeContactPhone("+62 (812) 345-678"); got != "+62812345678" {
		t.Fatalf("normalizeContactPhone() = %q", got)
	}
	options := normalizePollOptions([]string{"Yes", " ", "No", "Yes"})
	if len(options) != 2 || options[0] != "Yes" || options[1] != "No" {
		t.Fatalf("normalizePollOptions() = %#v", options)
	}
	contactText := contactMessageText(&waProto.ContactMessage{
		DisplayName: proto.String("Alice"),
		Vcard:       proto.String("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Alice\r\nTEL;TYPE=CELL;waid=62812:+62812\r\nEND:VCARD"),
	})
	if contactText != "Alice\n+62812" {
		t.Fatalf("contactMessageText() = %q", contactText)
	}
}

func TestStickerOutgoingMediaType(t *testing.T) {
	mediaType, messageType, err := normalizeOutgoingMediaType(ingest.MediaTypeSticker)
	if err != nil {
		t.Fatalf("normalizeOutgoingMediaType() returned error: %v", err)
	}
	if mediaType != ingest.MediaTypeSticker || messageType != ingest.MessageTypeSticker {
		t.Fatalf("normalizeOutgoingMediaType() = %q, %q", mediaType, messageType)
	}
}

func TestVoiceMessageBuildsPTTAudioPayload(t *testing.T) {
	message := buildMediaMessage(
		ingest.MediaTypeAudio,
		"audio/ogg; codecs=opus",
		"voice.ogg",
		"",
		true,
		7,
		whatsmeow.UploadResponse{URL: "https://example.invalid/audio", DirectPath: "/audio", FileLength: 12},
	)
	if message.GetAudioMessage() == nil {
		t.Fatal("audio message is nil")
	}
	if !message.GetAudioMessage().GetPTT() {
		t.Fatal("PTT = false, want true")
	}
	if message.GetAudioMessage().GetSeconds() != 7 {
		t.Fatalf("seconds = %d, want 7", message.GetAudioMessage().GetSeconds())
	}
}

func TestBuildQuotedReplyContextPreservesMessageTypeAndParticipant(t *testing.T) {
	contextInfo := buildQuotedReplyContext(SendReplyContext{
		WAMessageID: "quoted-message-1",
		SenderJID:   "628123456789:12@s.whatsapp.net",
		MessageType: "image",
		Text:        "产品照片",
	})

	if contextInfo.GetStanzaID() != "quoted-message-1" {
		t.Fatalf("stanza id = %q", contextInfo.GetStanzaID())
	}
	if contextInfo.GetParticipant() != "628123456789@s.whatsapp.net" {
		t.Fatalf("participant = %q", contextInfo.GetParticipant())
	}
	if contextInfo.GetQuotedMessage().GetImageMessage().GetCaption() != "产品照片" {
		t.Fatalf("quoted image = %#v", contextInfo.GetQuotedMessage())
	}
}

func TestIncomingVideoCallOfferEmitsNotificationEvent(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")
	events := make([]Event, 0, 1)
	connector.SetEventHandler(func(event Event) { events = append(events, event) })
	caller := waTypes.NewJID("628123456789", waTypes.DefaultUserServer)

	connector.handleWhatsmeowEvent(accountID, &waEvents.CallOffer{
		BasicCallMeta: waTypes.BasicCallMeta{From: caller, CallCreator: caller, CallID: "call-1"},
		Data:          &waBinary.Node{Tag: "offer", Content: []waBinary.Node{{Tag: "video", Attrs: waBinary.Attrs{"type": "video"}}}},
	})

	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
	if events[0].Type != EventTypeIncomingCall || events[0].Call == nil {
		t.Fatalf("event = %#v, want incoming call", events[0])
	}
	if events[0].Call.MediaType != "video" || events[0].Call.CallerJID != caller.String() {
		t.Fatalf("call = %#v, want video from %s", events[0].Call, caller.String())
	}
}

func TestIncomingCallOfferAndNoticeAreDeduplicated(t *testing.T) {
	accountID := "account-1"
	connector := newTestWhatsmeowConnector(accountID, "connected")
	events := make([]Event, 0, 2)
	connector.SetEventHandler(func(event Event) { events = append(events, event) })
	caller := waTypes.NewJID("628123456789", waTypes.DefaultUserServer)
	meta := waTypes.BasicCallMeta{From: caller, CallCreator: caller, CallID: "call-1"}

	connector.handleWhatsmeowEvent(accountID, &waEvents.CallOffer{BasicCallMeta: meta})
	connector.handleWhatsmeowEvent(accountID, &waEvents.CallOfferNotice{BasicCallMeta: meta, Media: "audio"})

	if len(events) != 1 {
		t.Fatalf("events = %d, want 1", len(events))
	}
}

func newTestWhatsmeowConnector(accountID, status string) *WhatsmeowConnector {
	jid := waTypes.NewJID("15551234567", waTypes.DefaultUserServer)
	client := whatsmeow.NewClient(&store.Device{ID: &jid}, nil)
	now := time.Unix(1700000000, 0).UTC()

	return &WhatsmeowConnector{
		logger:           slog.Default(),
		now:              func() time.Time { return now },
		incomingCallSeen: make(map[string]time.Time),
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
