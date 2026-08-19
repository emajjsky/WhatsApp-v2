package chats

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/ingest"
	"whatsapp-agent-platform/internal/storage"
)

type Repository struct {
	db storage.DBTX
}

type ChatListFilters struct {
	AccountID string
	Query     string
	ChatType  ingest.ChatType
	Limit     int
	Offset    int
}

type MessageListFilters struct {
	ChatID   string
	Limit    int
	Before   *time.Time
	DateFrom *time.Time
	DateTo   *time.Time
}

type ChatSummary struct {
	ID                   string              `json:"id"`
	AccountID            string              `json:"account_id"`
	WAChatJID            string              `json:"wa_chat_jid"`
	ChatType             ingest.ChatType     `json:"chat_type"`
	Title                *string             `json:"title,omitempty"`
	ParticipantCount     *int                `json:"participant_count,omitempty"`
	Archived             bool                `json:"archived"`
	LastMessageAt        *time.Time          `json:"last_message_at,omitempty"`
	LatestMessagePreview *string             `json:"latest_message_preview,omitempty"`
	LatestMessageType    *ingest.MessageType `json:"latest_message_type,omitempty"`
	LatestSenderJID      *string             `json:"latest_sender_jid,omitempty"`
	LatestFromMe         *bool               `json:"latest_from_me,omitempty"`
}

type ChatHeader struct {
	ID               string          `json:"id"`
	AccountID        string          `json:"account_id"`
	WAChatJID        string          `json:"wa_chat_jid"`
	ChatType         ingest.ChatType `json:"chat_type"`
	Title            *string         `json:"title,omitempty"`
	ParticipantCount *int            `json:"participant_count,omitempty"`
	Archived         bool            `json:"archived"`
	LastMessageAt    *time.Time      `json:"last_message_at,omitempty"`
}

type MediaAttachment struct {
	ID             string                `json:"id"`
	MessageID      string                `json:"message_id"`
	MediaType      ingest.MediaType      `json:"media_type"`
	MIMEType       *string               `json:"mime_type,omitempty"`
	FileName       *string               `json:"file_name,omitempty"`
	ByteSize       *int64                `json:"byte_size,omitempty"`
	SHA256         *string               `json:"sha256,omitempty"`
	StorageKey     *string               `json:"storage_key,omitempty"`
	DownloadStatus ingest.DownloadStatus `json:"download_status"`
}

type MessageView struct {
	ID                 string             `json:"id"`
	AccountID          string             `json:"account_id"`
	ChatID             string             `json:"chat_id"`
	WAMessageID        string             `json:"wa_message_id"`
	SenderJID          string             `json:"sender_jid"`
	SenderName         *string            `json:"sender_name,omitempty"`
	FromMe             bool               `json:"from_me"`
	MessageType        ingest.MessageType `json:"message_type"`
	TextContent        *string            `json:"text_content,omitempty"`
	ReplyToWAMessageID *string            `json:"reply_to_wa_message_id,omitempty"`
	SentAt             time.Time          `json:"sent_at"`
	DeliveredAt        *time.Time         `json:"delivered_at,omitempty"`
	ReadAt             *time.Time         `json:"read_at,omitempty"`
	Media              []MediaAttachment  `json:"media"`
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("chat repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) ResolveChatIDByWAJID(ctx context.Context, accountID, waChatJID string) (string, error) {
	const query = `
SELECT id
FROM chats
WHERE account_id = $1 AND wa_chat_jid = $2`

	var chatID string
	if err := r.db.QueryRowContext(ctx, query, accountID, waChatJID).Scan(&chatID); err != nil {
		return "", fmt.Errorf("resolve chat id by wa jid %q: %w", waChatJID, err)
	}

	return chatID, nil
}

func (r *Repository) ResolveMessageIDByWAID(ctx context.Context, accountID, waMessageID string) (string, error) {
	const query = `
SELECT id
FROM messages
WHERE account_id = $1 AND wa_message_id = $2`

	var messageID string
	if err := r.db.QueryRowContext(ctx, query, accountID, waMessageID).Scan(&messageID); err != nil {
		return "", fmt.Errorf("resolve message id by wa id %q: %w", waMessageID, err)
	}

	return messageID, nil
}

func (r *Repository) ListChats(ctx context.Context, filters ChatListFilters) ([]ChatSummary, int, error) {
	whereClause, args := buildChatListWhere(ctx, filters)

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM chats c WHERE %s`, whereClause)

	var total int
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count chats: %w", err)
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, filters.Limit, filters.Offset)
	limitIndex := len(args) + 1
	offsetIndex := len(args) + 2

	listQuery := fmt.Sprintf(`
SELECT
    c.id,
    c.account_id,
    c.wa_chat_jid,
    c.chat_type,
    CASE
        WHEN c.chat_type = 'direct' THEN COALESCE(
            NULLIF(ct.display_name, ''),
            NULLIF(ct.push_name, ''),
            NULLIF(wmct.full_name, ''),
            NULLIF(wmct.first_name, ''),
            NULLIF(wmct.push_name, ''),
            NULLIF(wmct.business_name, ''),
            NULLIF(wmct.redacted_phone, ''),
            NULLIF(wmpn.full_name, ''),
            NULLIF(wmpn.first_name, ''),
            NULLIF(wmpn.push_name, ''),
            NULLIF(wmpn.business_name, ''),
            NULLIF(wmpn.redacted_phone, ''),
            NULLIF(ct.phone_number, ''),
            NULLIF(lidmap.pn, ''),
            NULLIF(c.title, ''),
            c.wa_chat_jid
        )
        ELSE COALESCE(NULLIF(c.title, ''), c.wa_chat_jid)
    END AS display_title,
    c.participant_count,
    c.archived,
    COALESCE(latest.sent_at, c.last_message_at),
    latest.text_content,
    latest.message_type,
    latest.sender_jid,
    latest.from_me
FROM chats c
LEFT JOIN contacts ct
    ON ct.account_id = c.account_id
   AND ct.wa_jid = c.wa_chat_jid
LEFT JOIN session_credentials sc
    ON sc.account_id = c.account_id
LEFT JOIN whatsmeow_contacts wmct
    ON wmct.our_jid = sc.device_id
   AND wmct.their_jid = c.wa_chat_jid
LEFT JOIN whatsmeow_lid_map lidmap
    ON c.wa_chat_jid = CONCAT(lidmap.lid, '@lid')
LEFT JOIN whatsmeow_contacts wmpn
    ON wmpn.our_jid = sc.device_id
   AND wmpn.their_jid = CONCAT(lidmap.pn, '@s.whatsapp.net')
LEFT JOIN LATERAL (
    SELECT
        m.text_content,
        m.message_type,
        m.sender_jid,
        m.from_me,
        m.sent_at
    FROM messages m
    WHERE m.chat_id = c.id
      AND %s
    ORDER BY m.sent_at DESC, m.id DESC
    LIMIT 1
) AS latest ON TRUE
WHERE %s
ORDER BY COALESCE(latest.sent_at, c.last_message_at, c.updated_at) DESC, c.id DESC
LIMIT $%d OFFSET $%d`, visibleMessageCondition("m"), whereClause, limitIndex, offsetIndex)

	rows, err := r.db.QueryContext(ctx, listQuery, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list chats: %w", err)
	}
	defer rows.Close()

	items := make([]ChatSummary, 0, filters.Limit)
	for rows.Next() {
		var (
			item                 ChatSummary
			title                sql.NullString
			participantCount     sql.NullInt64
			lastMessageAt        sql.NullTime
			latestMessagePreview sql.NullString
			latestMessageType    sql.NullString
			latestSenderJID      sql.NullString
			latestFromMe         sql.NullBool
		)

		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.WAChatJID,
			&item.ChatType,
			&title,
			&participantCount,
			&item.Archived,
			&lastMessageAt,
			&latestMessagePreview,
			&latestMessageType,
			&latestSenderJID,
			&latestFromMe,
		); err != nil {
			return nil, 0, fmt.Errorf("scan chat row: %w", err)
		}

		item.Title = nullableString(title)
		item.ParticipantCount = nullableInt(participantCount)
		item.LastMessageAt = nullableTime(lastMessageAt)
		item.LatestMessagePreview = nullableString(latestMessagePreview)
		item.LatestMessageType = nullableMessageType(latestMessageType)
		item.LatestSenderJID = nullableString(latestSenderJID)
		item.LatestFromMe = nullableBool(latestFromMe)

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate chats: %w", err)
	}

	return items, total, nil
}

func (r *Repository) GetChatHeader(ctx context.Context, chatID string) (ChatHeader, error) {
	const baseQuery = `
SELECT
    c.id,
    c.account_id,
    c.wa_chat_jid,
    c.chat_type,
    CASE
        WHEN c.chat_type = 'direct' THEN COALESCE(
            NULLIF(ct.display_name, ''),
            NULLIF(ct.push_name, ''),
            NULLIF(wmct.full_name, ''),
            NULLIF(wmct.first_name, ''),
            NULLIF(wmct.push_name, ''),
            NULLIF(wmct.business_name, ''),
            NULLIF(wmct.redacted_phone, ''),
            NULLIF(wmpn.full_name, ''),
            NULLIF(wmpn.first_name, ''),
            NULLIF(wmpn.push_name, ''),
            NULLIF(wmpn.business_name, ''),
            NULLIF(wmpn.redacted_phone, ''),
            NULLIF(ct.phone_number, ''),
            NULLIF(lidmap.pn, ''),
            NULLIF(c.title, ''),
            c.wa_chat_jid
        )
        ELSE COALESCE(NULLIF(c.title, ''), c.wa_chat_jid)
    END AS display_title,
    c.participant_count,
    c.archived,
    c.last_message_at
FROM chats c
LEFT JOIN contacts ct
    ON ct.account_id = c.account_id
   AND ct.wa_jid = c.wa_chat_jid
LEFT JOIN session_credentials sc
    ON sc.account_id = c.account_id
LEFT JOIN whatsmeow_contacts wmct
    ON wmct.our_jid = sc.device_id
   AND wmct.their_jid = c.wa_chat_jid
LEFT JOIN whatsmeow_lid_map lidmap
    ON c.wa_chat_jid = CONCAT(lidmap.lid, '@lid')
LEFT JOIN whatsmeow_contacts wmpn
    ON wmpn.our_jid = sc.device_id
   AND wmpn.their_jid = CONCAT(lidmap.pn, '@s.whatsapp.net')
WHERE c.id = $1%s`

	scopeClause, scopeArgs := accountScopeCondition(ctx, "c.account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{chatID}, scopeArgs...)

	var (
		header           ChatHeader
		title            sql.NullString
		participantCount sql.NullInt64
		lastMessageAt    sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&header.ID,
		&header.AccountID,
		&header.WAChatJID,
		&header.ChatType,
		&title,
		&participantCount,
		&header.Archived,
		&lastMessageAt,
	); err != nil {
		return ChatHeader{}, fmt.Errorf("get chat %q: %w", chatID, err)
	}

	header.Title = nullableString(title)
	header.ParticipantCount = nullableInt(participantCount)
	header.LastMessageAt = nullableTime(lastMessageAt)

	return header, nil
}

func (r *Repository) ListChatHeadersByIDs(ctx context.Context, chatIDs []string) ([]ChatHeader, error) {
	if len(chatIDs) == 0 {
		return []ChatHeader{}, nil
	}

	args := make([]any, 0, len(chatIDs))
	placeholders := make([]string, 0, len(chatIDs))
	for index, chatID := range chatIDs {
		args = append(args, chatID)
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+1))
	}

	baseQuery := fmt.Sprintf(`
SELECT
    c.id,
    c.account_id,
    c.wa_chat_jid,
    c.chat_type,
    CASE
        WHEN c.chat_type = 'direct' THEN COALESCE(
            NULLIF(ct.display_name, ''),
            NULLIF(ct.push_name, ''),
            NULLIF(wmct.full_name, ''),
            NULLIF(wmct.first_name, ''),
            NULLIF(wmct.push_name, ''),
            NULLIF(wmct.business_name, ''),
            NULLIF(wmct.redacted_phone, ''),
            NULLIF(wmpn.full_name, ''),
            NULLIF(wmpn.first_name, ''),
            NULLIF(wmpn.push_name, ''),
            NULLIF(wmpn.business_name, ''),
            NULLIF(wmpn.redacted_phone, ''),
            NULLIF(ct.phone_number, ''),
            NULLIF(lidmap.pn, ''),
            NULLIF(c.title, ''),
            c.wa_chat_jid
        )
        ELSE COALESCE(NULLIF(c.title, ''), c.wa_chat_jid)
    END AS display_title,
    c.participant_count,
    c.archived,
    c.last_message_at
FROM chats c
LEFT JOIN contacts ct
    ON ct.account_id = c.account_id
   AND ct.wa_jid = c.wa_chat_jid
LEFT JOIN session_credentials sc
    ON sc.account_id = c.account_id
LEFT JOIN whatsmeow_contacts wmct
    ON wmct.our_jid = sc.device_id
   AND wmct.their_jid = c.wa_chat_jid
LEFT JOIN whatsmeow_lid_map lidmap
    ON c.wa_chat_jid = CONCAT(lidmap.lid, '@lid')
LEFT JOIN whatsmeow_contacts wmpn
    ON wmpn.our_jid = sc.device_id
   AND wmpn.their_jid = CONCAT(lidmap.pn, '@s.whatsapp.net')
WHERE c.id IN (%s)%%s`, strings.Join(placeholders, ", "))

	scopeClause, scopeArgs := accountScopeCondition(ctx, "c.account_id", len(args)+1)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args = append(args, scopeArgs...)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list chat headers by ids: %w", err)
	}
	defer rows.Close()

	headersByID := make(map[string]ChatHeader, len(chatIDs))
	for rows.Next() {
		var (
			header           ChatHeader
			title            sql.NullString
			participantCount sql.NullInt64
			lastMessageAt    sql.NullTime
		)

		if err := rows.Scan(
			&header.ID,
			&header.AccountID,
			&header.WAChatJID,
			&header.ChatType,
			&title,
			&participantCount,
			&header.Archived,
			&lastMessageAt,
		); err != nil {
			return nil, fmt.Errorf("scan chat header row: %w", err)
		}

		header.Title = nullableString(title)
		header.ParticipantCount = nullableInt(participantCount)
		header.LastMessageAt = nullableTime(lastMessageAt)
		headersByID[header.ID] = header
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chat headers: %w", err)
	}

	headers := make([]ChatHeader, 0, len(chatIDs))
	for _, chatID := range chatIDs {
		header, ok := headersByID[chatID]
		if !ok {
			return nil, sql.ErrNoRows
		}

		headers = append(headers, header)
	}

	return headers, nil
}

func (r *Repository) ListMessages(ctx context.Context, filters MessageListFilters) ([]MessageView, bool, error) {
	args := []any{filters.ChatID}
	conditions := []string{"m.chat_id = $1", visibleMessageCondition("m")}

	if filters.Before != nil {
		args = append(args, *filters.Before)
		conditions = append(conditions, fmt.Sprintf("m.sent_at < $%d", len(args)))
	}

	if filters.DateFrom != nil {
		args = append(args, *filters.DateFrom)
		conditions = append(conditions, fmt.Sprintf("m.sent_at >= $%d", len(args)))
	}

	if filters.DateTo != nil {
		args = append(args, *filters.DateTo)
		conditions = append(conditions, fmt.Sprintf("m.sent_at < $%d", len(args)))
	}
	if scopeCondition, scopeArgs := messageAccountScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}

	limitIndex := len(args) + 1
	args = append(args, filters.Limit+1)

	query := fmt.Sprintf(`
SELECT
    m.id,
    m.account_id,
    m.chat_id,
    m.wa_message_id,
    m.sender_jid,
    COALESCE(
        NULLIF(ct.display_name, ''),
        NULLIF(ct.push_name, ''),
        NULLIF(wmct.full_name, ''),
        NULLIF(wmct.first_name, ''),
        NULLIF(wmct.push_name, ''),
        NULLIF(wmct.business_name, ''),
        NULLIF(wmct.redacted_phone, ''),
        NULLIF(wmpn.full_name, ''),
        NULLIF(wmpn.first_name, ''),
        NULLIF(wmpn.push_name, ''),
        NULLIF(wmpn.business_name, ''),
        NULLIF(wmpn.redacted_phone, ''),
        NULLIF(ct.phone_number, ''),
        NULLIF(lidmap.pn, '')
    ) AS sender_name,
    m.from_me,
    m.message_type,
    m.text_content,
    m.reply_to_wa_message_id,
    m.sent_at,
    m.delivered_at,
    m.read_at
FROM messages m
LEFT JOIN contacts ct
    ON ct.account_id = m.account_id
   AND ct.wa_jid = m.sender_jid
LEFT JOIN session_credentials sc
    ON sc.account_id = m.account_id
LEFT JOIN whatsmeow_contacts wmct
    ON wmct.our_jid = sc.device_id
   AND wmct.their_jid = m.sender_jid
LEFT JOIN whatsmeow_lid_map lidmap
    ON m.sender_jid = CONCAT(lidmap.lid, '@lid')
LEFT JOIN whatsmeow_contacts wmpn
    ON wmpn.our_jid = sc.device_id
   AND wmpn.their_jid = CONCAT(lidmap.pn, '@s.whatsapp.net')
WHERE %s
ORDER BY m.sent_at DESC, m.id DESC
LIMIT $%d`, strings.Join(conditions, " AND "), limitIndex)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false, fmt.Errorf("list messages for chat %q: %w", filters.ChatID, err)
	}
	defer rows.Close()

	items := make([]MessageView, 0, filters.Limit+1)
	for rows.Next() {
		var (
			item               MessageView
			senderName         sql.NullString
			textContent        sql.NullString
			replyToWAMessageID sql.NullString
			deliveredAt        sql.NullTime
			readAt             sql.NullTime
		)

		if err := rows.Scan(
			&item.ID,
			&item.AccountID,
			&item.ChatID,
			&item.WAMessageID,
			&item.SenderJID,
			&senderName,
			&item.FromMe,
			&item.MessageType,
			&textContent,
			&replyToWAMessageID,
			&item.SentAt,
			&deliveredAt,
			&readAt,
		); err != nil {
			return nil, false, fmt.Errorf("scan message row: %w", err)
		}

		item.SenderName = nullableString(senderName)
		item.TextContent = nullableString(textContent)
		item.ReplyToWAMessageID = nullableString(replyToWAMessageID)
		item.DeliveredAt = nullableTime(deliveredAt)
		item.ReadAt = nullableTime(readAt)
		item.Media = make([]MediaAttachment, 0)

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("iterate messages: %w", err)
	}

	hasMore := len(items) > filters.Limit
	if hasMore {
		items = items[:filters.Limit]
	}

	reverseMessages(items)

	mediaByMessageID, err := r.listMediaByMessageIDs(ctx, extractMessageIDs(items))
	if err != nil {
		return nil, false, err
	}

	for i := range items {
		items[i].Media = mediaByMessageID[items[i].ID]
		if items[i].Media == nil {
			items[i].Media = make([]MediaAttachment, 0)
		}
	}

	return items, hasMore, nil
}

func (r *Repository) listMediaByMessageIDs(ctx context.Context, messageIDs []string) (map[string][]MediaAttachment, error) {
	result := make(map[string][]MediaAttachment, len(messageIDs))
	if len(messageIDs) == 0 {
		return result, nil
	}

	args := make([]any, 0, len(messageIDs))
	placeholders := make([]string, 0, len(messageIDs))
	for index, messageID := range messageIDs {
		args = append(args, messageID)
		placeholders = append(placeholders, fmt.Sprintf("$%d", index+1))
	}

	query := fmt.Sprintf(`
SELECT
    id,
    message_id,
    media_type,
    mime_type,
    file_name,
    byte_size,
    sha256,
    storage_key,
    download_status
FROM media_assets
WHERE message_id IN (%s)
ORDER BY created_at ASC`, strings.Join(placeholders, ", "))

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list media by message ids: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			item       MediaAttachment
			mimeType   sql.NullString
			fileName   sql.NullString
			byteSize   sql.NullInt64
			sha256     sql.NullString
			storageKey sql.NullString
			status     sql.NullString
		)

		if err := rows.Scan(
			&item.ID,
			&item.MessageID,
			&item.MediaType,
			&mimeType,
			&fileName,
			&byteSize,
			&sha256,
			&storageKey,
			&status,
		); err != nil {
			return nil, fmt.Errorf("scan media row: %w", err)
		}

		item.MIMEType = nullableString(mimeType)
		item.FileName = nullableString(fileName)
		item.ByteSize = nullableInt64(byteSize)
		item.SHA256 = nullableString(sha256)
		item.StorageKey = nullableString(storageKey)
		item.DownloadStatus = ingest.DownloadStatus(status.String)

		result[item.MessageID] = append(result[item.MessageID], item)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate media rows: %w", err)
	}

	return result, nil
}

func (r *Repository) GetMediaByID(ctx context.Context, mediaID string) (MediaAttachment, error) {
	const baseQuery = `
SELECT
    id,
    message_id,
    media_type,
    mime_type,
    file_name,
    byte_size,
    sha256,
    storage_key,
    download_status
FROM media_assets ma
WHERE ma.id = $1%s`

	scopeClause, scopeArgs := mediaAccountScopeCondition(ctx, 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{mediaID}, scopeArgs...)

	var (
		item       MediaAttachment
		mimeType   sql.NullString
		fileName   sql.NullString
		byteSize   sql.NullInt64
		sha256     sql.NullString
		storageKey sql.NullString
		status     sql.NullString
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&item.ID,
		&item.MessageID,
		&item.MediaType,
		&mimeType,
		&fileName,
		&byteSize,
		&sha256,
		&storageKey,
		&status,
	); err != nil {
		return MediaAttachment{}, fmt.Errorf("get media %q: %w", mediaID, err)
	}

	item.MIMEType = nullableString(mimeType)
	item.FileName = nullableString(fileName)
	item.ByteSize = nullableInt64(byteSize)
	item.SHA256 = nullableString(sha256)
	item.StorageKey = nullableString(storageKey)
	item.DownloadStatus = ingest.DownloadStatus(status.String)

	return item, nil
}

func ResolveStoragePath(storageKey string) (string, error) {
	trimmed := strings.TrimSpace(storageKey)
	if trimmed == "" {
		return "", fmt.Errorf("storage key is empty")
	}

	cleaned := filepath.Clean(trimmed)
	base := filepath.Clean("data")
	if cleaned == base || strings.HasPrefix(cleaned, base+string(os.PathSeparator)) {
		return cleaned, nil
	}

	return "", fmt.Errorf("storage key must stay inside data/")
}

func buildChatListWhere(ctx context.Context, filters ChatListFilters) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 3)

	if filters.AccountID != "" {
		args = append(args, filters.AccountID)
		conditions = append(conditions, fmt.Sprintf("c.account_id = $%d", len(args)))
	}

	if filters.ChatType != "" {
		args = append(args, filters.ChatType)
		conditions = append(conditions, fmt.Sprintf("c.chat_type = $%d", len(args)))
	}

	if filters.Query != "" {
		args = append(args, "%"+filters.Query+"%")
		index := len(args)
		conditions = append(conditions, fmt.Sprintf(`(
    COALESCE(c.title, '') ILIKE $%d
    OR c.wa_chat_jid ILIKE $%d
    OR EXISTS (
        SELECT 1
        FROM messages sm
        WHERE sm.chat_id = c.id
          AND %s
          AND COALESCE(sm.text_content, '') ILIKE $%d
    )
)`, index, index, visibleMessageCondition("sm"), index))
	}

	conditions = append(conditions, fmt.Sprintf(`(
    NOT EXISTS (
        SELECT 1
        FROM messages cm
        WHERE cm.chat_id = c.id
    )
    OR EXISTS (
        SELECT 1
        FROM messages vm
        WHERE vm.chat_id = c.id
          AND %s
    )
)`, visibleMessageCondition("vm")))
	if scopeCondition, scopeArgs := chatAccountScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}

	return strings.Join(conditions, " AND "), args
}

func visibleMessageCondition(alias string) string {
	return fmt.Sprintf("(%s.message_type <> 'system' OR COALESCE(%s.text_content, '') NOT LIKE 'protocol:%%')", alias, alias)
}

func chatAccountScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(`EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = c.account_id
      AND account_scope.user_id = $%d
)`, startIndex), []any{currentUser.ID}
}

func accountScopeCondition(ctx context.Context, accountColumn string, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(` AND EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = %s
      AND account_scope.user_id = $%d
)`, accountColumn, startIndex), []any{currentUser.ID}
}

func messageAccountScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(`EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = m.account_id
      AND account_scope.user_id = $%d
)`, startIndex), []any{currentUser.ID}
}

func mediaAccountScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(` AND EXISTS (
    SELECT 1
    FROM messages media_message
    JOIN accounts account_scope ON account_scope.id = media_message.account_id
    WHERE media_message.id = ma.message_id
      AND account_scope.user_id = $%d
)`, startIndex), []any{currentUser.ID}
}

func extractMessageIDs(messages []MessageView) []string {
	ids := make([]string, 0, len(messages))
	for _, item := range messages {
		ids = append(ids, item.ID)
	}

	return ids
}

func reverseMessages(messages []MessageView) {
	for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
		messages[left], messages[right] = messages[right], messages[left]
	}
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}

func nullableInt(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}

	result := int(value.Int64)
	return &result
}

func nullableInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}

	result := value.Int64
	return &result
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time
	return &result
}

func nullableBool(value sql.NullBool) *bool {
	if !value.Valid {
		return nil
	}

	result := value.Bool
	return &result
}

func nullableMessageType(value sql.NullString) *ingest.MessageType {
	if !value.Valid {
		return nil
	}

	result := ingest.MessageType(value.String)
	return &result
}
