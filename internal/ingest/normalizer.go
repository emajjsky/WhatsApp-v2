package ingest

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type RawEvent struct {
	AccountID string
	Chat      ChatSnapshot
	Contact   *ContactSnapshot
	Message   MessageInput
	Media     []MediaInput
	Payload   map[string]any
}

type ChatSnapshot struct {
	AccountID        string
	WAChatJID        string
	ChatType         ChatType
	Title            *string
	ParticipantCount *int
	Archived         bool
	MutedUntil       *time.Time
	LastMessageAt    *time.Time
}

type ContactSnapshot struct {
	AccountID       string
	WAJID           string
	DisplayName     *string
	PushName        *string
	PhoneNumber     *string
	ProfilePhotoURL *string
	IsBusiness      bool
}

type MessageInput struct {
	AccountID        string
	WAMessageID      string
	SenderJID        string
	FromMe           bool
	MessageType      MessageType
	TextContent      *string
	ReplyToWAMessageID *string
	SentAt           time.Time
	DeliveredAt      *time.Time
	ReadAt           *time.Time
}

type MediaInput struct {
	MediaType      MediaType
	MIMEType       *string
	FileName       *string
	ByteSize       *int64
	SHA256         *string
	StorageKey     *string
	DownloadStatus DownloadStatus
}

type NormalizedEvent struct {
	Chat    ChatSnapshot
	Contact *ContactSnapshot
	Message NormalizedMessage
	Media   []MediaInput
}

type NormalizedMessage struct {
	AccountID        string
	WAMessageID      string
	SenderJID        string
	FromMe           bool
	MessageType      MessageType
	TextContent      *string
	ReplyToWAMessageID *string
	SentAt           time.Time
	DeliveredAt      *time.Time
	ReadAt           *time.Time
	RawPayload       []byte
}

type Normalizer struct{}

func NewNormalizer() *Normalizer {
	return &Normalizer{}
}

func (n *Normalizer) Normalize(event RawEvent) (NormalizedEvent, error) {
	accountID := strings.TrimSpace(event.AccountID)
	if accountID == "" {
		return NormalizedEvent{}, fmt.Errorf("account_id is required")
	}

	chat := event.Chat
	chat.AccountID = accountID
	if strings.TrimSpace(chat.WAChatJID) == "" {
		return NormalizedEvent{}, fmt.Errorf("chat.wa_chat_jid is required")
	}
	if chat.ChatType == "" {
		chat.ChatType = ChatTypeDirect
	}

	message := event.Message
	message.AccountID = accountID
	if strings.TrimSpace(message.WAMessageID) == "" {
		return NormalizedEvent{}, fmt.Errorf("message.wa_message_id is required")
	}
	if strings.TrimSpace(message.SenderJID) == "" {
		return NormalizedEvent{}, fmt.Errorf("message.sender_jid is required")
	}
	if message.MessageType == "" {
		message.MessageType = MessageTypeUnknown
	}
	if message.SentAt.IsZero() {
		message.SentAt = time.Now().UTC()
	}

	rawPayload, err := json.Marshal(event.Payload)
	if err != nil {
		return NormalizedEvent{}, fmt.Errorf("marshal raw payload: %w", err)
	}

	var contact *ContactSnapshot
	if event.Contact != nil {
		cloned := *event.Contact
		cloned.AccountID = accountID
		if strings.TrimSpace(cloned.WAJID) == "" {
			return NormalizedEvent{}, fmt.Errorf("contact.wa_jid is required when contact is provided")
		}
		contact = &cloned
	}

	return NormalizedEvent{
		Chat:    chat,
		Contact: contact,
		Message: NormalizedMessage{
			AccountID:        accountID,
			WAMessageID:      message.WAMessageID,
			SenderJID:        message.SenderJID,
			FromMe:           message.FromMe,
			MessageType:      message.MessageType,
			TextContent:      message.TextContent,
			ReplyToWAMessageID: message.ReplyToWAMessageID,
			SentAt:           message.SentAt,
			DeliveredAt:      message.DeliveredAt,
			ReadAt:           message.ReadAt,
			RawPayload:       rawPayload,
		},
		Media: event.Media,
	}, nil
}
