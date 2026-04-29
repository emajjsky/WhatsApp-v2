package chats

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/ingest"
	"whatsapp-agent-platform/internal/sessions"
)

var ErrChatNotFound = errors.New("chat not found")

const (
	sendMessageTimeout = 12 * time.Second
	sendMediaTimeout   = 75 * time.Second
)

type messageSender interface {
	SendText(ctx context.Context, accountID, chatJID, text string) (sessions.SendResult, error)
	SendMedia(ctx context.Context, accountID, chatJID string, input sessions.SendMediaInput) (sessions.SendResult, error)
}

type Service struct {
	repository *Repository
	sender     messageSender
}

type ListChatsInput struct {
	AccountID string
	Query     string
	ChatType  ingest.ChatType
	Limit     int
	Offset    int
}

type ListChatsResult struct {
	Chats  []ChatSummary `json:"chats"`
	Total  int           `json:"total"`
	Limit  int           `json:"limit"`
	Offset int           `json:"offset"`
}

type GetMessagesInput struct {
	ChatID string
	Limit  int
	Before *time.Time
}

type MessageHistoryResult struct {
	Chat       ChatHeader    `json:"chat"`
	Messages   []MessageView `json:"messages"`
	Limit      int           `json:"limit"`
	HasMore    bool          `json:"has_more"`
	NextBefore *time.Time    `json:"next_before,omitempty"`
}

type SendMessageInput struct {
	ChatID      string
	MessageText string `json:"message_text"`
}

type SendMessageResult struct {
	ChatID      string    `json:"chat_id"`
	WAChatJID   string    `json:"wa_chat_jid"`
	WAMessageID string    `json:"wa_message_id"`
	MessageText string    `json:"message_text"`
	SentAt      time.Time `json:"sent_at"`
}

type SendMediaInput struct {
	ChatID    string
	MediaType ingest.MediaType
	FileName  string
	MIMEType  string
	Caption   string
	Data      []byte
}

type SendMediaResult struct {
	ChatID      string             `json:"chat_id"`
	WAChatJID   string             `json:"wa_chat_jid"`
	WAMessageID string             `json:"wa_message_id"`
	MessageType ingest.MessageType `json:"message_type"`
	MediaType   ingest.MediaType   `json:"media_type"`
	FileName    string             `json:"file_name,omitempty"`
	MIMEType    string             `json:"mime_type,omitempty"`
	Caption     string             `json:"caption,omitempty"`
	SentAt      time.Time          `json:"sent_at"`
}

func NewService(repository *Repository, sender messageSender) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("chat service requires a repository")
	}

	return &Service{repository: repository, sender: sender}, nil
}

const (
	defaultChatListLimit    = 24
	maxChatListLimit        = 5000
	defaultMessageListLimit = 50
	maxMessageListLimit     = 100
)

func (s *Service) ListChats(ctx context.Context, input ListChatsInput) (ListChatsResult, error) {
	limit := input.Limit
	if limit <= 0 {
		limit = defaultChatListLimit
	}
	if limit > maxChatListLimit {
		limit = maxChatListLimit
	}

	offset := input.Offset
	if offset < 0 {
		offset = 0
	}

	chatType := normalizeChatType(input.ChatType)
	if input.ChatType != "" && chatType == "" {
		return ListChatsResult{}, fmt.Errorf("unsupported chat_type %q", input.ChatType)
	}

	items, total, err := s.repository.ListChats(ctx, ChatListFilters{
		AccountID: strings.TrimSpace(input.AccountID),
		Query:     strings.TrimSpace(input.Query),
		ChatType:  chatType,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		return ListChatsResult{}, err
	}

	return ListChatsResult{
		Chats:  items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

func (s *Service) GetMessages(ctx context.Context, input GetMessagesInput) (MessageHistoryResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return MessageHistoryResult{}, fmt.Errorf("chat_id is required")
	}

	limit := input.Limit
	if limit <= 0 {
		limit = defaultMessageListLimit
	}
	if limit > maxMessageListLimit {
		limit = maxMessageListLimit
	}

	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return MessageHistoryResult{}, mapRepositoryError(chatID, err)
	}

	messages, hasMore, err := s.repository.ListMessages(ctx, MessageListFilters{
		ChatID: chatID,
		Limit:  limit,
		Before: input.Before,
	})
	if err != nil {
		return MessageHistoryResult{}, err
	}

	var nextBefore *time.Time
	if hasMore && len(messages) > 0 {
		cursor := messages[0].SentAt
		nextBefore = &cursor
	}

	return MessageHistoryResult{
		Chat:       header,
		Messages:   messages,
		Limit:      limit,
		HasMore:    hasMore,
		NextBefore: nextBefore,
	}, nil
}

func (s *Service) SendMessage(ctx context.Context, input SendMessageInput) (SendMessageResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return SendMessageResult{}, fmt.Errorf("chat_id is required")
	}

	messageText := strings.TrimSpace(input.MessageText)
	if messageText == "" {
		return SendMessageResult{}, fmt.Errorf("message_text is required")
	}
	if s.sender == nil {
		return SendMessageResult{}, fmt.Errorf("chat service sender is not configured")
	}

	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return SendMessageResult{}, mapRepositoryError(chatID, err)
	}

	sendCtx, cancel := context.WithTimeout(ctx, sendMessageTimeout)
	defer cancel()

	sendResult, err := s.sender.SendText(sendCtx, header.AccountID, header.WAChatJID, messageText)
	if err != nil {
		return SendMessageResult{}, err
	}

	return SendMessageResult{
		ChatID:      header.ID,
		WAChatJID:   header.WAChatJID,
		WAMessageID: sendResult.WAMessageID,
		MessageText: messageText,
		SentAt:      sendResult.SentAt,
	}, nil
}

func (s *Service) SendMedia(ctx context.Context, input SendMediaInput) (SendMediaResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return SendMediaResult{}, fmt.Errorf("chat_id is required")
	}

	mediaType, messageType, err := normalizeSendMediaType(input.MediaType)
	if err != nil {
		return SendMediaResult{}, err
	}
	if len(input.Data) == 0 {
		return SendMediaResult{}, fmt.Errorf("media file is required")
	}
	if s.sender == nil {
		return SendMediaResult{}, fmt.Errorf("chat service sender is not configured")
	}

	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return SendMediaResult{}, mapRepositoryError(chatID, err)
	}

	sendCtx, cancel := context.WithTimeout(ctx, sendMediaTimeout)
	defer cancel()

	caption := strings.TrimSpace(input.Caption)
	sendResult, err := s.sender.SendMedia(sendCtx, header.AccountID, header.WAChatJID, sessions.SendMediaInput{
		MediaType: mediaType,
		FileName:  strings.TrimSpace(input.FileName),
		MIMEType:  strings.TrimSpace(input.MIMEType),
		Caption:   caption,
		Data:      input.Data,
	})
	if err != nil {
		return SendMediaResult{}, err
	}

	return SendMediaResult{
		ChatID:      header.ID,
		WAChatJID:   header.WAChatJID,
		WAMessageID: sendResult.WAMessageID,
		MessageType: messageType,
		MediaType:   mediaType,
		FileName:    strings.TrimSpace(input.FileName),
		MIMEType:    strings.TrimSpace(input.MIMEType),
		Caption:     caption,
		SentAt:      sendResult.SentAt,
	}, nil
}

func (s *Service) GetMediaContentPath(ctx context.Context, mediaID string) (string, *string, error) {
	mediaID = strings.TrimSpace(mediaID)
	if mediaID == "" {
		return "", nil, fmt.Errorf("media_id is required")
	}

	media, err := s.repository.GetMediaByID(ctx, mediaID)
	if err != nil {
		return "", nil, err
	}
	if media.DownloadStatus != ingest.DownloadStatusReady {
		return "", nil, fmt.Errorf("media %s is not ready for download", mediaID)
	}
	if media.StorageKey == nil {
		return "", nil, fmt.Errorf("media %s has no storage path", mediaID)
	}

	path, err := ResolveStoragePath(*media.StorageKey)
	if err != nil {
		return "", nil, err
	}

	return path, media.MIMEType, nil
}

func normalizeSendMediaType(value ingest.MediaType) (ingest.MediaType, ingest.MessageType, error) {
	switch ingest.MediaType(strings.ToLower(strings.TrimSpace(string(value)))) {
	case ingest.MediaTypeImage:
		return ingest.MediaTypeImage, ingest.MessageTypeImage, nil
	case ingest.MediaTypeVideo:
		return ingest.MediaTypeVideo, ingest.MessageTypeVideo, nil
	case ingest.MediaTypeAudio:
		return ingest.MediaTypeAudio, ingest.MessageTypeAudio, nil
	case ingest.MediaTypeDocument, "", ingest.MediaTypeOther:
		return ingest.MediaTypeDocument, ingest.MessageTypeDocument, nil
	default:
		return "", "", fmt.Errorf("unsupported media_type %q", value)
	}
}

func mapRepositoryError(chatID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrChatNotFound, chatID)
	}

	return err
}

func normalizeChatType(value ingest.ChatType) ingest.ChatType {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case "":
		return ""
	case string(ingest.ChatTypeDirect):
		return ingest.ChatTypeDirect
	case string(ingest.ChatTypeGroup):
		return ingest.ChatTypeGroup
	case string(ingest.ChatTypeBroadcast):
		return ingest.ChatTypeBroadcast
	case string(ingest.ChatTypeStatus):
		return ingest.ChatTypeStatus
	default:
		return ""
	}
}
