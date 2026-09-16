package chats

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
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
	SendText(ctx context.Context, accountID, chatJID, text string, replyTo ...string) (sessions.SendResult, error)
	SendMedia(ctx context.Context, accountID, chatJID string, input sessions.SendMediaInput) (sessions.SendResult, error)
}

type structuredMessageSender interface {
	SendContact(ctx context.Context, accountID, chatJID string, input sessions.SendContactInput) (sessions.SendResult, error)
	SendPoll(ctx context.Context, accountID, chatJID string, input sessions.SendPollInput) (sessions.SendResult, error)
}

type chatReadMarker interface {
	MarkRead(ctx context.Context, accountID, chatJID string, messageIDs []string, senderJID string, timestamp time.Time) error
}

type messageOperator interface {
	ReactToMessage(ctx context.Context, accountID, chatJID, senderJID, messageID, reaction string) error
	EditTextMessage(ctx context.Context, accountID, chatJID, messageID, text string) error
	RevokeMessage(ctx context.Context, accountID, chatJID, senderJID, messageID string) error
	StarMessage(ctx context.Context, accountID, chatJID, senderJID, messageID string, fromMe, starred bool) error
}

type Service struct {
	repository *Repository
	sender     messageSender
	richSender structuredMessageSender
	readMarker chatReadMarker
	operator   messageOperator
}

type ListChatsInput struct {
	AccountID  string
	Query      string
	ChatType   ingest.ChatType
	LabelID    string
	Archived   *bool
	UnreadOnly bool
	Limit      int
	Offset     int
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

type SearchMessagesInput struct {
	ChatID string
	Query  string
	Limit  int
}

type FindMessageByDateInput struct {
	ChatID string
	From   *time.Time
	To     *time.Time
}

type MessageHistoryResult struct {
	Chat       ChatHeader    `json:"chat"`
	Messages   []MessageView `json:"messages"`
	Limit      int           `json:"limit"`
	HasMore    bool          `json:"has_more"`
	NextBefore *time.Time    `json:"next_before,omitempty"`
}

type MessageSearchResult struct {
	Messages []MessageView `json:"messages"`
	Total    int           `json:"total"`
}

type MessageByDateResult struct {
	Message *MessageView `json:"message"`
}

type ListContactsInput struct {
	AccountID string
	Query     string
	Limit     int
	Offset    int
}

type ListContactsResult struct {
	Contacts []ContactView `json:"contacts"`
	Total    int           `json:"total"`
	Limit    int           `json:"limit"`
	Offset   int           `json:"offset"`
}

type UpdateContactInput struct {
	ContactID string
	Note      string `json:"note"`
}

type CreateContactInput struct {
	ChatID      string `json:"chat_id"`
	DisplayName string `json:"display_name"`
}

type UpdateMessageMetadataInput struct {
	ChatID    string `json:"chat_id"`
	MessageID string `json:"message_id"`
	Starred   bool   `json:"starred"`
	Pinned    bool   `json:"pinned"`
}

type MessageReactionInput struct {
	ChatID    string `json:"chat_id"`
	MessageID string `json:"message_id"`
	Reaction  string `json:"reaction"`
}

type EditMessageInput struct {
	ChatID    string `json:"chat_id"`
	MessageID string `json:"message_id"`
	Text      string `json:"text"`
}

type DeleteMessageInput struct {
	ChatID      string `json:"chat_id"`
	MessageID   string `json:"message_id"`
	ForEveryone bool   `json:"for_everyone"`
}

type ForwardMessageInput struct {
	ChatID       string `json:"chat_id"`
	MessageID    string `json:"message_id"`
	TargetChatID string `json:"target_chat_id"`
}

type SendContactInput struct {
	ChatID      string `json:"chat_id"`
	DisplayName string `json:"display_name"`
	PhoneNumber string `json:"phone_number"`
}

type SendPollInput struct {
	ChatID        string   `json:"chat_id"`
	Question      string   `json:"question"`
	Options       []string `json:"options"`
	AllowMultiple bool     `json:"allow_multiple"`
}

type CreateLabelInput struct {
	AccountID string `json:"account_id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
}

type UpdateChatMetadataInput struct {
	ChatID       string     `json:"chat_id"`
	Note         string     `json:"note"`
	Pinned       bool       `json:"pinned"`
	Archived     bool       `json:"archived"`
	MarkedUnread bool       `json:"marked_unread"`
	MutedUntil   *time.Time `json:"muted_until"`
	LabelIDs     []string   `json:"label_ids"`
}

type SendMessageInput struct {
	ChatID           string
	MessageText      string `json:"message_text"`
	ReplyToMessageID string `json:"reply_to_wa_message_id,omitempty"`
}

type SendMessageResult struct {
	ChatID      string    `json:"chat_id"`
	WAChatJID   string    `json:"wa_chat_jid"`
	WAMessageID string    `json:"wa_message_id"`
	MessageText string    `json:"message_text"`
	SentAt      time.Time `json:"sent_at"`
}

type SendMediaInput struct {
	ChatID          string
	MediaType       ingest.MediaType
	FileName        string
	MIMEType        string
	Caption         string
	Data            []byte
	VoiceMessage    bool
	DurationSeconds uint32
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

	service := &Service{repository: repository, sender: sender}
	if richSender, ok := sender.(structuredMessageSender); ok {
		service.richSender = richSender
	}
	if marker, ok := sender.(chatReadMarker); ok {
		service.readMarker = marker
	}
	if operator, ok := sender.(messageOperator); ok {
		service.operator = operator
	}
	return service, nil
}

const (
	defaultChatListLimit      = 24
	maxChatListLimit          = 5000
	defaultMessageListLimit   = 50
	maxMessageListLimit       = 100
	defaultMessageSearchLimit = 100
	maxMessageSearchLimit     = 100
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
		AccountID:  strings.TrimSpace(input.AccountID),
		Query:      strings.TrimSpace(input.Query),
		ChatType:   chatType,
		LabelID:    strings.TrimSpace(input.LabelID),
		Archived:   input.Archived,
		UnreadOnly: input.UnreadOnly,
		Limit:      limit,
		Offset:     offset,
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

func (s *Service) ListContacts(ctx context.Context, input ListContactsInput) (ListContactsResult, error) {
	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return ListContactsResult{}, fmt.Errorf("account_id is required")
	}
	limit := input.Limit
	if limit <= 0 {
		limit = 100
	}
	if limit > 2000 {
		limit = 2000
	}
	offset := input.Offset
	if offset < 0 {
		offset = 0
	}
	items, total, err := s.repository.ListContacts(ctx, accountID, strings.TrimSpace(input.Query), limit, offset)
	if err != nil {
		return ListContactsResult{}, err
	}
	return ListContactsResult{Contacts: items, Total: total, Limit: limit, Offset: offset}, nil
}

func (s *Service) UpdateContact(ctx context.Context, input UpdateContactInput) (ContactView, error) {
	contactID := strings.TrimSpace(input.ContactID)
	if contactID == "" {
		return ContactView{}, fmt.Errorf("contact_id is required")
	}
	if len([]rune(input.Note)) > 2000 {
		return ContactView{}, fmt.Errorf("note is too long")
	}
	item, err := s.repository.UpdateContactNote(ctx, contactID, strings.TrimSpace(input.Note))
	if err != nil {
		return ContactView{}, mapRepositoryError(contactID, err)
	}
	return item, nil
}

func (s *Service) CreateContact(ctx context.Context, input CreateContactInput) (ContactView, error) {
	chatID := strings.TrimSpace(input.ChatID)
	displayName := strings.TrimSpace(input.DisplayName)
	if chatID == "" {
		return ContactView{}, fmt.Errorf("chat_id is required")
	}
	if displayName == "" {
		return ContactView{}, fmt.Errorf("display_name is required")
	}
	if len([]rune(displayName)) > 120 {
		return ContactView{}, fmt.Errorf("display_name is too long")
	}
	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return ContactView{}, mapRepositoryError(chatID, err)
	}
	if header.ChatType != ingest.ChatTypeDirect {
		return ContactView{}, fmt.Errorf("only direct chats can be saved as contacts")
	}
	item, err := s.repository.CreateContactFromChat(ctx, chatID, displayName)
	if err != nil {
		return ContactView{}, mapRepositoryError(chatID, err)
	}
	return item, nil
}

func (s *Service) UpdateMessageMetadata(ctx context.Context, input UpdateMessageMetadataInput) (MessageView, error) {
	target, err := s.requireMessageTarget(ctx, input.ChatID, input.MessageID)
	if err != nil {
		return MessageView{}, err
	}
	if target.Starred != input.Starred {
		if s.operator == nil {
			return MessageView{}, fmt.Errorf("session connector does not support starring messages")
		}
		if err := s.operator.StarMessage(ctx, target.AccountID, target.WAChatJID, target.SenderJID,
			target.WAMessageID, target.FromMe, input.Starred); err != nil {
			return MessageView{}, err
		}
	}
	if err := s.repository.UpdateMessageMetadata(ctx, target.ChatID, target.ID, input.Starred, input.Pinned); err != nil {
		return MessageView{}, mapRepositoryError(target.ID, err)
	}
	return s.messageView(ctx, target.ChatID, target.ID)
}

func (s *Service) ReactToMessage(ctx context.Context, input MessageReactionInput) (MessageView, error) {
	target, err := s.requireMessageTarget(ctx, input.ChatID, input.MessageID)
	if err != nil {
		return MessageView{}, err
	}
	if s.operator == nil {
		return MessageView{}, fmt.Errorf("session connector does not support message reactions")
	}
	reaction := strings.TrimSpace(input.Reaction)
	if len([]rune(reaction)) > 8 {
		return MessageView{}, fmt.Errorf("reaction is too long")
	}
	if err := s.operator.ReactToMessage(ctx, target.AccountID, target.WAChatJID, target.SenderJID, target.WAMessageID, reaction); err != nil {
		return MessageView{}, err
	}
	if err := s.repository.UpdateMessageReaction(ctx, target.ChatID, target.ID, "self", reaction); err != nil {
		return MessageView{}, mapRepositoryError(target.ID, err)
	}
	return s.messageView(ctx, target.ChatID, target.ID)
}

func (s *Service) EditMessage(ctx context.Context, input EditMessageInput) (MessageView, error) {
	target, err := s.requireMessageTarget(ctx, input.ChatID, input.MessageID)
	if err != nil {
		return MessageView{}, err
	}
	text := strings.TrimSpace(input.Text)
	if !target.FromMe || target.MessageType != ingest.MessageTypeText {
		return MessageView{}, fmt.Errorf("only your text messages can be edited")
	}
	if text == "" {
		return MessageView{}, fmt.Errorf("text is required")
	}
	if time.Since(target.SentAt) > 20*time.Minute {
		return MessageView{}, fmt.Errorf("the WhatsApp edit window has expired")
	}
	if s.operator == nil {
		return MessageView{}, fmt.Errorf("session connector does not support message editing")
	}
	if err := s.operator.EditTextMessage(ctx, target.AccountID, target.WAChatJID, target.WAMessageID, text); err != nil {
		return MessageView{}, err
	}
	if err := s.repository.UpdateMessageText(ctx, target.ChatID, target.ID, text); err != nil {
		return MessageView{}, err
	}
	return s.messageView(ctx, target.ChatID, target.ID)
}

func (s *Service) DeleteMessage(ctx context.Context, input DeleteMessageInput) error {
	target, err := s.requireMessageTarget(ctx, input.ChatID, input.MessageID)
	if err != nil {
		return err
	}
	if input.ForEveryone {
		if !target.FromMe {
			return fmt.Errorf("only your messages can be deleted for everyone")
		}
		if s.operator == nil {
			return fmt.Errorf("session connector does not support message deletion")
		}
		if err := s.operator.RevokeMessage(ctx, target.AccountID, target.WAChatJID, "", target.WAMessageID); err != nil {
			return err
		}
	}
	storageKeys, err := s.repository.DeleteMessage(ctx, target.ChatID, target.ID)
	if err != nil {
		return mapRepositoryError(target.ID, err)
	}
	removeStoredMedia(storageKeys)
	return nil
}

func (s *Service) ForwardMessage(ctx context.Context, input ForwardMessageInput) (SendMessageResult, error) {
	target, err := s.requireMessageTarget(ctx, input.ChatID, input.MessageID)
	if err != nil {
		return SendMessageResult{}, err
	}
	source, err := s.messageView(ctx, target.ChatID, target.ID)
	if err != nil {
		return SendMessageResult{}, err
	}
	if len(source.Media) > 0 {
		var result SendMediaResult
		for index, media := range source.Media {
			if media.StorageKey == nil || strings.TrimSpace(*media.StorageKey) == "" {
				return SendMessageResult{}, fmt.Errorf("this media is not available for forwarding")
			}
			path, err := ResolveStoragePath(*media.StorageKey)
			if err != nil {
				return SendMessageResult{}, err
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return SendMessageResult{}, fmt.Errorf("read media for forwarding: %w", err)
			}
			caption := ""
			if index == 0 && source.TextContent != nil {
				caption = *source.TextContent
			}
			result, err = s.SendMedia(ctx, SendMediaInput{
				ChatID:    strings.TrimSpace(input.TargetChatID),
				MediaType: media.MediaType,
				FileName:  valueOrEmpty(media.FileName),
				MIMEType:  valueOrEmpty(media.MIMEType),
				Caption:   caption,
				Data:      data,
			})
			if err != nil {
				return SendMessageResult{}, err
			}
		}
		return SendMessageResult{
			ChatID:      result.ChatID,
			WAChatJID:   result.WAChatJID,
			WAMessageID: result.WAMessageID,
			MessageText: result.FileName,
			SentAt:      result.SentAt,
		}, nil
	}
	if target.TextContent == nil || strings.TrimSpace(*target.TextContent) == "" {
		return SendMessageResult{}, fmt.Errorf("this message cannot be forwarded yet")
	}
	return s.SendMessage(ctx, SendMessageInput{ChatID: strings.TrimSpace(input.TargetChatID), MessageText: *target.TextContent})
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func (s *Service) ClearChat(ctx context.Context, chatID string) error {
	chatID = strings.TrimSpace(chatID)
	storageKeys, err := s.repository.ClearChat(ctx, chatID)
	if err != nil {
		return mapRepositoryError(chatID, err)
	}
	removeStoredMedia(storageKeys)
	return nil
}

func (s *Service) DeleteChat(ctx context.Context, chatID string) error {
	chatID = strings.TrimSpace(chatID)
	storageKeys, err := s.repository.DeleteChat(ctx, chatID)
	if err != nil {
		return mapRepositoryError(chatID, err)
	}
	removeStoredMedia(storageKeys)
	return nil
}

func (s *Service) SendContact(ctx context.Context, input SendContactInput) (SendMessageResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	displayName := strings.TrimSpace(input.DisplayName)
	phoneNumber := strings.TrimSpace(input.PhoneNumber)
	if chatID == "" || displayName == "" || phoneNumber == "" {
		return SendMessageResult{}, fmt.Errorf("chat_id, display_name and phone_number are required")
	}
	if len([]rune(displayName)) > 120 || len([]rune(phoneNumber)) > 40 {
		return SendMessageResult{}, fmt.Errorf("contact name or phone number is too long")
	}
	if s.richSender == nil {
		return SendMessageResult{}, fmt.Errorf("chat service sender does not support contacts")
	}
	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return SendMessageResult{}, mapRepositoryError(chatID, err)
	}
	sendCtx, cancel := context.WithTimeout(ctx, sendMessageTimeout)
	defer cancel()
	result, err := s.richSender.SendContact(sendCtx, header.AccountID, header.WAChatJID, sessions.SendContactInput{DisplayName: displayName, PhoneNumber: phoneNumber})
	if err != nil {
		return SendMessageResult{}, err
	}
	return SendMessageResult{ChatID: header.ID, WAChatJID: header.WAChatJID, WAMessageID: result.WAMessageID, MessageText: displayName, SentAt: result.SentAt}, nil
}

func (s *Service) SendPoll(ctx context.Context, input SendPollInput) (SendMessageResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	question := strings.TrimSpace(input.Question)
	options := normalizePollOptions(input.Options)
	if chatID == "" || question == "" {
		return SendMessageResult{}, fmt.Errorf("chat_id and question are required")
	}
	if len([]rune(question)) > 255 {
		return SendMessageResult{}, fmt.Errorf("poll question is too long")
	}
	if len(options) < 2 || len(options) > 12 {
		return SendMessageResult{}, fmt.Errorf("poll requires 2 to 12 unique options")
	}
	for _, option := range options {
		if len([]rune(option)) > 100 {
			return SendMessageResult{}, fmt.Errorf("poll option is too long")
		}
	}
	if s.richSender == nil {
		return SendMessageResult{}, fmt.Errorf("chat service sender does not support polls")
	}
	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return SendMessageResult{}, mapRepositoryError(chatID, err)
	}
	sendCtx, cancel := context.WithTimeout(ctx, sendMessageTimeout)
	defer cancel()
	result, err := s.richSender.SendPoll(sendCtx, header.AccountID, header.WAChatJID, sessions.SendPollInput{Question: question, Options: options, AllowMultiple: input.AllowMultiple})
	if err != nil {
		return SendMessageResult{}, err
	}
	return SendMessageResult{ChatID: header.ID, WAChatJID: header.WAChatJID, WAMessageID: result.WAMessageID, MessageText: question, SentAt: result.SentAt}, nil
}

func normalizePollOptions(options []string) []string {
	result := make([]string, 0, len(options))
	seen := make(map[string]struct{}, len(options))
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func (s *Service) requireMessageTarget(ctx context.Context, chatID, messageID string) (MessageActionTarget, error) {
	chatID = strings.TrimSpace(chatID)
	messageID = strings.TrimSpace(messageID)
	if chatID == "" || messageID == "" {
		return MessageActionTarget{}, fmt.Errorf("chat_id and message_id are required")
	}
	target, err := s.repository.GetMessageActionTarget(ctx, chatID, messageID)
	if err != nil {
		return MessageActionTarget{}, mapRepositoryError(messageID, err)
	}
	return target, nil
}

func (s *Service) messageView(ctx context.Context, chatID, messageID string) (MessageView, error) {
	messages, _, err := s.repository.ListMessages(ctx, MessageListFilters{ChatID: chatID, MessageID: messageID, Limit: 1})
	if err != nil {
		return MessageView{}, err
	}
	if len(messages) == 1 {
		return messages[0], nil
	}
	return MessageView{}, ErrChatNotFound
}

func removeStoredMedia(storageKeys []string) {
	for _, storageKey := range storageKeys {
		path, err := ResolveStoragePath(storageKey)
		if err != nil {
			continue
		}
		_ = os.Remove(path)
	}
}

func (s *Service) ListLabels(ctx context.Context, accountID string) ([]ChatLabel, error) {
	accountID = strings.TrimSpace(accountID)
	if accountID == "" {
		return nil, fmt.Errorf("account_id is required")
	}
	return s.repository.ListLabels(ctx, accountID)
}

func (s *Service) CreateLabel(ctx context.Context, input CreateLabelInput) (ChatLabel, error) {
	input.AccountID = strings.TrimSpace(input.AccountID)
	input.Name = strings.TrimSpace(input.Name)
	input.Color = strings.TrimSpace(input.Color)
	if input.AccountID == "" || input.Name == "" {
		return ChatLabel{}, fmt.Errorf("account_id and name are required")
	}
	if len([]rune(input.Name)) > 32 {
		return ChatLabel{}, fmt.Errorf("label name is too long")
	}
	if input.Color == "" {
		input.Color = "#25d366"
	}
	if !isHexColor(input.Color) {
		return ChatLabel{}, fmt.Errorf("color must be a hex color")
	}
	return s.repository.CreateLabel(ctx, input.AccountID, input.Name, input.Color)
}

func (s *Service) DeleteLabel(ctx context.Context, labelID string) error {
	if err := s.repository.DeleteLabel(ctx, strings.TrimSpace(labelID)); err != nil {
		return mapRepositoryError(labelID, err)
	}
	return nil
}

func (s *Service) UpdateChatMetadata(ctx context.Context, input UpdateChatMetadataInput) (ChatHeader, error) {
	input.ChatID = strings.TrimSpace(input.ChatID)
	input.Note = strings.TrimSpace(input.Note)
	if input.ChatID == "" {
		return ChatHeader{}, fmt.Errorf("chat_id is required")
	}
	if len([]rune(input.Note)) > 2000 {
		return ChatHeader{}, fmt.Errorf("note is too long")
	}
	item, err := s.repository.UpdateChatMetadata(ctx, input.ChatID, input)
	if err != nil {
		return ChatHeader{}, mapRepositoryError(input.ChatID, err)
	}
	return item, nil
}

func (s *Service) MarkChatRead(ctx context.Context, chatID string) (ChatHeader, error) {
	chatID = strings.TrimSpace(chatID)
	if chatID == "" {
		return ChatHeader{}, fmt.Errorf("chat_id is required")
	}
	header, err := s.repository.GetChatHeader(ctx, chatID)
	if err != nil {
		return ChatHeader{}, mapRepositoryError(chatID, err)
	}
	if s.readMarker == nil {
		return ChatHeader{}, fmt.Errorf("session connector does not support read receipts")
	}
	messages, _, err := s.repository.ListMessages(ctx, MessageListFilters{ChatID: chatID, Limit: 100})
	if err != nil {
		return ChatHeader{}, err
	}
	if len(messages) > 0 && !messages[0].FromMe {
		latest := messages[0]
		if err := s.readMarker.MarkRead(ctx, header.AccountID, header.WAChatJID, []string{latest.WAMessageID}, latest.SenderJID, latest.SentAt); err != nil {
			return ChatHeader{}, err
		}
	}
	return s.repository.ClearChatUnread(ctx, chatID)
}

func isHexColor(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	for _, char := range value[1:] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
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

func (s *Service) SearchMessages(ctx context.Context, input SearchMessagesInput) (MessageSearchResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	query := strings.TrimSpace(input.Query)
	if chatID == "" {
		return MessageSearchResult{}, fmt.Errorf("chat_id is required")
	}
	if query == "" {
		return MessageSearchResult{}, fmt.Errorf("query is required")
	}
	if len([]rune(query)) > 200 {
		return MessageSearchResult{}, fmt.Errorf("query is too long")
	}

	limit := input.Limit
	if limit <= 0 {
		limit = defaultMessageSearchLimit
	}
	if limit > maxMessageSearchLimit {
		limit = maxMessageSearchLimit
	}

	if _, err := s.repository.GetChatHeader(ctx, chatID); err != nil {
		return MessageSearchResult{}, mapRepositoryError(chatID, err)
	}

	messages, total, err := s.repository.SearchMessages(ctx, chatID, query, limit)
	if err != nil {
		return MessageSearchResult{}, err
	}
	return MessageSearchResult{Messages: messages, Total: total}, nil
}

func (s *Service) FindMessageByDate(ctx context.Context, input FindMessageByDateInput) (MessageByDateResult, error) {
	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return MessageByDateResult{}, fmt.Errorf("chat_id is required")
	}
	if input.From == nil || input.To == nil {
		return MessageByDateResult{}, fmt.Errorf("from and to are required")
	}
	if !input.From.Before(*input.To) {
		return MessageByDateResult{}, fmt.Errorf("from must be before to")
	}
	if input.To.Sub(*input.From) > 48*time.Hour {
		return MessageByDateResult{}, fmt.Errorf("date range must not exceed 48 hours")
	}

	if _, err := s.repository.GetChatHeader(ctx, chatID); err != nil {
		return MessageByDateResult{}, mapRepositoryError(chatID, err)
	}

	messages, _, err := s.repository.ListMessages(ctx, MessageListFilters{
		ChatID:    chatID,
		DateFrom:  input.From,
		DateTo:    input.To,
		Limit:     1,
		Ascending: true,
	})
	if err != nil {
		return MessageByDateResult{}, err
	}
	if len(messages) == 0 {
		return MessageByDateResult{Message: nil}, nil
	}
	return MessageByDateResult{Message: &messages[0]}, nil
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

	var replyTo []string
	if trimmedReplyTo := strings.TrimSpace(input.ReplyToMessageID); trimmedReplyTo != "" {
		replyTo = []string{trimmedReplyTo}
	}
	sendResult, err := s.sender.SendText(sendCtx, header.AccountID, header.WAChatJID, messageText, replyTo...)
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
	if input.VoiceMessage && mediaType != ingest.MediaTypeAudio {
		return SendMediaResult{}, fmt.Errorf("voice messages must use audio media")
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
		MediaType:       mediaType,
		FileName:        strings.TrimSpace(input.FileName),
		MIMEType:        strings.TrimSpace(input.MIMEType),
		Caption:         caption,
		Data:            input.Data,
		VoiceMessage:    input.VoiceMessage,
		DurationSeconds: input.DurationSeconds,
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
	case ingest.MediaTypeSticker:
		return ingest.MediaTypeSticker, ingest.MessageTypeSticker, nil
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
