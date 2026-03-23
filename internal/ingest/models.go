package ingest

import "time"

type ChatType string

const (
	ChatTypeDirect    ChatType = "direct"
	ChatTypeGroup     ChatType = "group"
	ChatTypeBroadcast ChatType = "broadcast"
	ChatTypeStatus    ChatType = "status"
)

type MessageType string

const (
	MessageTypeText     MessageType = "text"
	MessageTypeImage    MessageType = "image"
	MessageTypeVideo    MessageType = "video"
	MessageTypeAudio    MessageType = "audio"
	MessageTypeDocument MessageType = "document"
	MessageTypeSticker  MessageType = "sticker"
	MessageTypeReaction MessageType = "reaction"
	MessageTypeSystem   MessageType = "system"
	MessageTypeLocation MessageType = "location"
	MessageTypeContact  MessageType = "contact"
	MessageTypePoll     MessageType = "poll"
	MessageTypeUnknown  MessageType = "unknown"
)

type MediaType string

const (
	MediaTypeImage     MediaType = "image"
	MediaTypeVideo     MediaType = "video"
	MediaTypeAudio     MediaType = "audio"
	MediaTypeDocument  MediaType = "document"
	MediaTypeSticker   MediaType = "sticker"
	MediaTypeThumbnail MediaType = "thumbnail"
	MediaTypeOther     MediaType = "other"
)

type DownloadStatus string

const (
	DownloadStatusPending DownloadStatus = "pending"
	DownloadStatusReady   DownloadStatus = "ready"
	DownloadStatusFailed  DownloadStatus = "failed"
	DownloadStatusExpired DownloadStatus = "expired"
)

type Contact struct {
	ID              string
	AccountID       string
	WAJID           string
	DisplayName     *string
	PushName        *string
	PhoneNumber     *string
	ProfilePhotoURL *string
	IsBusiness      bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type Chat struct {
	ID               string
	AccountID        string
	WAChatJID        string
	ChatType         ChatType
	Title            *string
	ParticipantCount *int
	Archived         bool
	MutedUntil       *time.Time
	LastMessageID    *string
	LastMessageAt    *time.Time
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type Message struct {
	ID               string
	AccountID        string
	ChatID           string
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
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type MediaAsset struct {
	ID             string
	MessageID      string
	MediaType      MediaType
	MIMEType       *string
	FileName       *string
	ByteSize       *int64
	SHA256         *string
	StorageKey     *string
	DownloadStatus DownloadStatus
	CreatedAt      time.Time
}
