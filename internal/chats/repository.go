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
	"whatsapp-agent-platform/internal/support/ids"
)

type Repository struct {
	db storage.DBTX
}

type ChatListFilters struct {
	AccountID  string
	Query      string
	ChatType   ingest.ChatType
	LabelID    string
	Archived   *bool
	UnreadOnly bool
	Limit      int
	Offset     int
}

type MessageListFilters struct {
	ChatID   string
	Query    string
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
	Pinned               bool                `json:"pinned"`
	MarkedUnread         bool                `json:"marked_unread"`
	MutedUntil           *time.Time          `json:"muted_until,omitempty"`
	Note                 string              `json:"note"`
	PhoneNumber          *string             `json:"phone_number,omitempty"`
	ProfilePhotoURL      *string             `json:"profile_photo_url,omitempty"`
	Labels               []ChatLabel         `json:"labels"`
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
	Pinned           bool            `json:"pinned"`
	MarkedUnread     bool            `json:"marked_unread"`
	MutedUntil       *time.Time      `json:"muted_until,omitempty"`
	Note             string          `json:"note"`
	PhoneNumber      *string         `json:"phone_number,omitempty"`
	ProfilePhotoURL  *string         `json:"profile_photo_url,omitempty"`
	Labels           []ChatLabel     `json:"labels"`
	LastMessageAt    *time.Time      `json:"last_message_at,omitempty"`
}

type ChatLabel struct {
	ID        string    `json:"id"`
	AccountID string    `json:"account_id"`
	Name      string    `json:"name"`
	Color     string    `json:"color"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type ContactView struct {
	ID              string      `json:"id"`
	AccountID       string      `json:"account_id"`
	ChatID          *string     `json:"chat_id,omitempty"`
	WAJID           string      `json:"wa_jid"`
	DisplayName     string      `json:"display_name"`
	PhoneNumber     *string     `json:"phone_number,omitempty"`
	ProfilePhotoURL *string     `json:"profile_photo_url,omitempty"`
	IsBusiness      bool        `json:"is_business"`
	Note            string      `json:"note"`
	LastMessageAt   *time.Time  `json:"last_message_at,omitempty"`
	Labels          []ChatLabel `json:"labels"`
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
    c.pinned,
    c.marked_unread,
    c.muted_until,
    c.note,
    COALESCE(NULLIF(ct.phone_number, ''), NULLIF(lidmap.pn, '')),
    ct.profile_photo_url,
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
ORDER BY c.pinned DESC, c.marked_unread DESC, COALESCE(latest.sent_at, c.last_message_at, c.updated_at) DESC, c.id DESC
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
			mutedUntil           sql.NullTime
			phoneNumber          sql.NullString
			profilePhotoURL      sql.NullString
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
			&item.Pinned,
			&item.MarkedUnread,
			&mutedUntil,
			&item.Note,
			&phoneNumber,
			&profilePhotoURL,
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
		item.MutedUntil = nullableTime(mutedUntil)
		item.PhoneNumber = nullableString(phoneNumber)
		item.ProfilePhotoURL = nullableString(profilePhotoURL)
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

	labelsByChat, err := r.listLabelsByChatIDs(ctx, chatSummaryIDs(items))
	if err != nil {
		return nil, 0, err
	}
	for index := range items {
		items[index].Labels = labelsByChat[items[index].ID]
		if items[index].Labels == nil {
			items[index].Labels = []ChatLabel{}
		}
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
    c.pinned,
    c.marked_unread,
    c.muted_until,
    c.note,
    COALESCE(NULLIF(ct.phone_number, ''), NULLIF(lidmap.pn, '')),
    ct.profile_photo_url,
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
		mutedUntil       sql.NullTime
		phoneNumber      sql.NullString
		profilePhotoURL  sql.NullString
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
		&header.Pinned,
		&header.MarkedUnread,
		&mutedUntil,
		&header.Note,
		&phoneNumber,
		&profilePhotoURL,
		&lastMessageAt,
	); err != nil {
		return ChatHeader{}, fmt.Errorf("get chat %q: %w", chatID, err)
	}

	header.Title = nullableString(title)
	header.ParticipantCount = nullableInt(participantCount)
	header.MutedUntil = nullableTime(mutedUntil)
	header.PhoneNumber = nullableString(phoneNumber)
	header.ProfilePhotoURL = nullableString(profilePhotoURL)
	header.LastMessageAt = nullableTime(lastMessageAt)
	labelsByChat, err := r.listLabelsByChatIDs(ctx, []string{header.ID})
	if err != nil {
		return ChatHeader{}, err
	}
	header.Labels = labelsByChat[header.ID]
	if header.Labels == nil {
		header.Labels = []ChatLabel{}
	}

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
    c.pinned,
    c.marked_unread,
    c.muted_until,
    c.note,
    COALESCE(NULLIF(ct.phone_number, ''), NULLIF(lidmap.pn, '')),
    ct.profile_photo_url,
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
			mutedUntil       sql.NullTime
			phoneNumber      sql.NullString
			profilePhotoURL  sql.NullString
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
			&header.Pinned,
			&header.MarkedUnread,
			&mutedUntil,
			&header.Note,
			&phoneNumber,
			&profilePhotoURL,
			&lastMessageAt,
		); err != nil {
			return nil, fmt.Errorf("scan chat header row: %w", err)
		}

		header.Title = nullableString(title)
		header.ParticipantCount = nullableInt(participantCount)
		header.MutedUntil = nullableTime(mutedUntil)
		header.PhoneNumber = nullableString(phoneNumber)
		header.ProfilePhotoURL = nullableString(profilePhotoURL)
		header.LastMessageAt = nullableTime(lastMessageAt)
		headersByID[header.ID] = header
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate chat headers: %w", err)
	}
	labelsByChat, err := r.listLabelsByChatIDs(ctx, chatIDs)
	if err != nil {
		return nil, err
	}

	headers := make([]ChatHeader, 0, len(chatIDs))
	for _, chatID := range chatIDs {
		header, ok := headersByID[chatID]
		if !ok {
			return nil, sql.ErrNoRows
		}
		header.Labels = labelsByChat[header.ID]
		if header.Labels == nil {
			header.Labels = []ChatLabel{}
		}

		headers = append(headers, header)
	}

	return headers, nil
}

func (r *Repository) ListMessages(ctx context.Context, filters MessageListFilters) ([]MessageView, bool, error) {
	args := []any{filters.ChatID}
	conditions := []string{"m.chat_id = $1", visibleMessageCondition("m")}
	if query := strings.TrimSpace(filters.Query); query != "" {
		args = append(args, "%"+query+"%")
		conditions = append(conditions, fmt.Sprintf("LOWER(COALESCE(m.text_content, '')) LIKE LOWER($%d)", len(args)))
	}

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

func (r *Repository) SearchMessages(ctx context.Context, chatID, query string, limit int) ([]MessageView, int, error) {
	args := []any{chatID, "%" + strings.TrimSpace(query) + "%"}
	conditions := []string{
		"m.chat_id = $1",
		visibleMessageCondition("m"),
		"LOWER(COALESCE(m.text_content, '')) LIKE LOWER($2)",
	}
	if scopeCondition, scopeArgs := messageAccountScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}
	where := strings.Join(conditions, " AND ")

	var total int
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM messages m WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count messages for chat %q: %w", chatID, err)
	}

	messages, _, err := r.ListMessages(ctx, MessageListFilters{
		ChatID: chatID,
		Query:  query,
		Limit:  limit,
	})
	if err != nil {
		return nil, 0, err
	}
	reverseMessages(messages)
	return messages, total, nil
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

func (r *Repository) ListContacts(ctx context.Context, accountID, query string, limit, offset int) ([]ContactView, int, error) {
	conditions := []string{"ct.account_id = $1"}
	args := []any{accountID}
	if strings.TrimSpace(query) != "" {
		args = append(args, "%"+strings.TrimSpace(query)+"%")
		index := len(args)
		conditions = append(conditions, fmt.Sprintf(`(
    COALESCE(ct.display_name, '') ILIKE $%d OR COALESCE(ct.push_name, '') ILIKE $%d
    OR COALESCE(ct.phone_number, '') ILIKE $%d OR ct.wa_jid ILIKE $%d OR COALESCE(ct.note, '') ILIKE $%d
)`, index, index, index, index, index))
	}
	if scopeCondition, scopeArgs := accountScopeCondition(ctx, "ct.account_id", len(args)+1); scopeCondition != "" {
		conditions = append(conditions, strings.TrimPrefix(scopeCondition, " AND "))
		args = append(args, scopeArgs...)
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM contacts ct WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count contacts: %w", err)
	}

	listArgs := append(append([]any{}, args...), limit, offset)
	rows, err := r.db.QueryContext(ctx, fmt.Sprintf(`
SELECT ct.id, ct.account_id, c.id, ct.wa_jid,
       COALESCE(NULLIF(ct.display_name, ''), NULLIF(ct.push_name, ''), NULLIF(ct.phone_number, ''), ct.wa_jid),
       ct.phone_number, ct.profile_photo_url, ct.is_business, ct.note, c.last_message_at
FROM contacts ct
LEFT JOIN chats c ON c.account_id = ct.account_id AND c.wa_chat_jid = ct.wa_jid
WHERE %s
ORDER BY COALESCE(c.last_message_at, ct.updated_at) DESC, ct.id DESC
LIMIT $%d OFFSET $%d`, where, len(args)+1, len(args)+2), listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list contacts: %w", err)
	}
	defer rows.Close()

	items := make([]ContactView, 0, limit)
	for rows.Next() {
		var item ContactView
		var chatID, phone, photo sql.NullString
		var lastMessageAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.AccountID, &chatID, &item.WAJID, &item.DisplayName, &phone, &photo, &item.IsBusiness, &item.Note, &lastMessageAt); err != nil {
			return nil, 0, fmt.Errorf("scan contact: %w", err)
		}
		item.ChatID = nullableString(chatID)
		item.PhoneNumber = nullableString(phone)
		item.ProfilePhotoURL = nullableString(photo)
		item.LastMessageAt = nullableTime(lastMessageAt)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate contacts: %w", err)
	}

	chatIDs := make([]string, 0, len(items))
	for _, item := range items {
		if item.ChatID != nil {
			chatIDs = append(chatIDs, *item.ChatID)
		}
	}
	labelsByChat, err := r.listLabelsByChatIDs(ctx, chatIDs)
	if err != nil {
		return nil, 0, err
	}
	for index := range items {
		items[index].Labels = []ChatLabel{}
		if items[index].ChatID != nil {
			items[index].Labels = labelsByChat[*items[index].ChatID]
			if items[index].Labels == nil {
				items[index].Labels = []ChatLabel{}
			}
		}
	}
	return items, total, nil
}

func (r *Repository) UpdateContactNote(ctx context.Context, contactID, note string) (ContactView, error) {
	query := `UPDATE contacts ct SET note = $2, updated_at = NOW() WHERE ct.id = $1`
	if scopeCondition, _ := accountScopeCondition(ctx, "ct.account_id", 3); scopeCondition != "" {
		query += scopeCondition
	}
	args := []any{contactID, note}
	if currentUser, ok := auth.CurrentUser(ctx); ok && !currentUser.IsAdmin() {
		args = append(args, currentUser.ID)
	}
	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return ContactView{}, fmt.Errorf("update contact note: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return ContactView{}, sql.ErrNoRows
	}
	return r.getContactByID(ctx, contactID)
}

func (r *Repository) getContactByID(ctx context.Context, contactID string) (ContactView, error) {
	query := `SELECT ct.id, ct.account_id, c.id, ct.wa_jid,
COALESCE(NULLIF(ct.display_name, ''), NULLIF(ct.push_name, ''), NULLIF(ct.phone_number, ''), ct.wa_jid),
ct.phone_number, ct.profile_photo_url, ct.is_business, ct.note, c.last_message_at
FROM contacts ct LEFT JOIN chats c ON c.account_id = ct.account_id AND c.wa_chat_jid = ct.wa_jid
WHERE ct.id = $1`
	args := []any{contactID}
	if scopeCondition, scopeArgs := accountScopeCondition(ctx, "ct.account_id", 2); scopeCondition != "" {
		query += scopeCondition
		args = append(args, scopeArgs...)
	}
	var item ContactView
	var chatID, phone, photo sql.NullString
	var lastMessageAt sql.NullTime
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&item.ID, &item.AccountID, &chatID, &item.WAJID, &item.DisplayName, &phone, &photo, &item.IsBusiness, &item.Note, &lastMessageAt); err != nil {
		return ContactView{}, err
	}
	item.ChatID = nullableString(chatID)
	item.PhoneNumber = nullableString(phone)
	item.ProfilePhotoURL = nullableString(photo)
	item.LastMessageAt = nullableTime(lastMessageAt)
	item.Labels = []ChatLabel{}
	if item.ChatID != nil {
		labels, err := r.listLabelsByChatIDs(ctx, []string{*item.ChatID})
		if err != nil {
			return ContactView{}, err
		}
		item.Labels = labels[*item.ChatID]
		if item.Labels == nil {
			item.Labels = []ChatLabel{}
		}
	}
	return item, nil
}

func (r *Repository) ListLabels(ctx context.Context, accountID string) ([]ChatLabel, error) {
	query := `SELECT cl.id, cl.account_id, cl.name, cl.color, cl.created_at, cl.updated_at FROM chat_labels cl WHERE cl.account_id = $1`
	args := []any{accountID}
	if scopeCondition, scopeArgs := accountScopeCondition(ctx, "cl.account_id", 2); scopeCondition != "" {
		query += scopeCondition
		args = append(args, scopeArgs...)
	}
	query += " ORDER BY cl.name"
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list chat labels: %w", err)
	}
	defer rows.Close()
	items := []ChatLabel{}
	for rows.Next() {
		var item ChatLabel
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Name, &item.Color, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan chat label: %w", err)
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (r *Repository) CreateLabel(ctx context.Context, accountID, name, color string) (ChatLabel, error) {
	if err := r.requireAccountAccess(ctx, accountID); err != nil {
		return ChatLabel{}, err
	}
	var item ChatLabel
	err := r.db.QueryRowContext(ctx, `INSERT INTO chat_labels (id, account_id, name, color) VALUES ($1, $2, $3, $4)
RETURNING id, account_id, name, color, created_at, updated_at`, ids.NewUUID(), accountID, name, color).Scan(
		&item.ID, &item.AccountID, &item.Name, &item.Color, &item.CreatedAt, &item.UpdatedAt,
	)
	if err != nil {
		return ChatLabel{}, fmt.Errorf("create chat label: %w", err)
	}
	return item, nil
}

func (r *Repository) DeleteLabel(ctx context.Context, labelID string) error {
	query := `DELETE FROM chat_labels cl WHERE cl.id = $1`
	args := []any{labelID}
	if scopeCondition, scopeArgs := accountScopeCondition(ctx, "cl.account_id", 2); scopeCondition != "" {
		query += scopeCondition
		args = append(args, scopeArgs...)
	}
	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("delete chat label: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func (r *Repository) UpdateChatMetadata(ctx context.Context, chatID string, input UpdateChatMetadataInput) (ChatHeader, error) {
	if _, err := r.GetChatHeader(ctx, chatID); err != nil {
		return ChatHeader{}, err
	}
	if _, err := r.db.ExecContext(ctx, `UPDATE chats SET note = $2, pinned = $3, archived = $4,
marked_unread = $5, muted_until = $6, updated_at = NOW() WHERE id = $1`, chatID, input.Note, input.Pinned, input.Archived, input.MarkedUnread, input.MutedUntil); err != nil {
		return ChatHeader{}, fmt.Errorf("update chat metadata: %w", err)
	}
	if input.LabelIDs != nil {
		if _, err := r.db.ExecContext(ctx, `DELETE FROM chat_label_assignments WHERE chat_id = $1`, chatID); err != nil {
			return ChatHeader{}, fmt.Errorf("clear chat labels: %w", err)
		}
		for _, labelID := range input.LabelIDs {
			if _, err := r.db.ExecContext(ctx, `INSERT INTO chat_label_assignments (chat_id, label_id)
SELECT $1, cl.id FROM chat_labels cl JOIN chats c ON c.id = $1
WHERE cl.id = $2 AND cl.account_id = c.account_id ON CONFLICT DO NOTHING`, chatID, labelID); err != nil {
				return ChatHeader{}, fmt.Errorf("assign chat label: %w", err)
			}
		}
	}
	return r.GetChatHeader(ctx, chatID)
}

func (r *Repository) ClearChatUnread(ctx context.Context, chatID string) (ChatHeader, error) {
	if _, err := r.GetChatHeader(ctx, chatID); err != nil {
		return ChatHeader{}, err
	}
	if _, err := r.db.ExecContext(ctx, `UPDATE chats SET marked_unread = FALSE, updated_at = NOW() WHERE id = $1`, chatID); err != nil {
		return ChatHeader{}, fmt.Errorf("clear chat unread marker: %w", err)
	}
	return r.GetChatHeader(ctx, chatID)
}

func (r *Repository) listLabelsByChatIDs(ctx context.Context, chatIDs []string) (map[string][]ChatLabel, error) {
	result := make(map[string][]ChatLabel, len(chatIDs))
	if len(chatIDs) == 0 {
		return result, nil
	}
	args := make([]any, 0, len(chatIDs)+1)
	placeholders := make([]string, 0, len(chatIDs))
	for _, chatID := range chatIDs {
		args = append(args, chatID)
		placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
	}
	query := fmt.Sprintf(`SELECT cla.chat_id, cl.id, cl.account_id, cl.name, cl.color, cl.created_at, cl.updated_at
FROM chat_label_assignments cla JOIN chat_labels cl ON cl.id = cla.label_id JOIN chats c ON c.id = cla.chat_id
WHERE cla.chat_id IN (%s)`, strings.Join(placeholders, ","))
	if scopeCondition, scopeArgs := accountScopeCondition(ctx, "c.account_id", len(args)+1); scopeCondition != "" {
		query += scopeCondition
		args = append(args, scopeArgs...)
	}
	query += " ORDER BY cl.name"
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list assigned chat labels: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var chatID string
		var label ChatLabel
		if err := rows.Scan(&chatID, &label.ID, &label.AccountID, &label.Name, &label.Color, &label.CreatedAt, &label.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan assigned chat label: %w", err)
		}
		result[chatID] = append(result[chatID], label)
	}
	return result, rows.Err()
}

func (r *Repository) requireAccountAccess(ctx context.Context, accountID string) error {
	query := `SELECT 1 FROM accounts a WHERE a.id = $1`
	args := []any{accountID}
	if currentUser, ok := auth.CurrentUser(ctx); ok && !currentUser.IsAdmin() {
		query += ` AND a.user_id = $2`
		args = append(args, currentUser.ID)
	}
	var exists int
	return r.db.QueryRowContext(ctx, query, args...).Scan(&exists)
}

func chatSummaryIDs(items []ChatSummary) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, item.ID)
	}
	return result
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

	if filters.Archived != nil {
		args = append(args, *filters.Archived)
		conditions = append(conditions, fmt.Sprintf("c.archived = $%d", len(args)))
	}

	if filters.UnreadOnly {
		conditions = append(conditions, "c.marked_unread = TRUE")
	}

	if filters.LabelID != "" {
		args = append(args, filters.LabelID)
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
    SELECT 1 FROM chat_label_assignments filter_label
    WHERE filter_label.chat_id = c.id AND filter_label.label_id = $%d
)`, len(args)))
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
