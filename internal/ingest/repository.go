package ingest

import (
	"context"
	"database/sql"
	"fmt"

	"whatsapp-agent-platform/internal/support/ids"
	"whatsapp-agent-platform/internal/storage"
)

type Repository struct {
	db storage.DBTX
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("ingest repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) UpsertContact(ctx context.Context, contact ContactSnapshot) (string, error) {
	const query = `
INSERT INTO contacts (
    id,
    account_id,
    wa_jid,
    display_name,
    push_name,
    phone_number,
    profile_photo_url,
    is_business
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (account_id, wa_jid)
DO UPDATE SET
    display_name = EXCLUDED.display_name,
    push_name = EXCLUDED.push_name,
    phone_number = EXCLUDED.phone_number,
    profile_photo_url = EXCLUDED.profile_photo_url,
    is_business = EXCLUDED.is_business,
    updated_at = NOW()
RETURNING id`

	id := newID()
	var storedID string
	if err := r.db.QueryRowContext(
		ctx,
		query,
		id,
		contact.AccountID,
		contact.WAJID,
		contact.DisplayName,
		contact.PushName,
		contact.PhoneNumber,
		contact.ProfilePhotoURL,
		contact.IsBusiness,
	).Scan(&storedID); err != nil {
		return "", fmt.Errorf("upsert contact %q: %w", contact.WAJID, err)
	}

	return storedID, nil
}

func (r *Repository) UpsertChat(ctx context.Context, chat ChatSnapshot) (string, error) {
	const query = `
INSERT INTO chats (
    id,
    account_id,
    wa_chat_jid,
    chat_type,
    title,
    participant_count,
    archived,
    muted_until,
    last_message_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (account_id, wa_chat_jid)
DO UPDATE SET
    chat_type = EXCLUDED.chat_type,
    title = EXCLUDED.title,
    participant_count = EXCLUDED.participant_count,
    archived = EXCLUDED.archived,
    muted_until = EXCLUDED.muted_until,
    last_message_at = EXCLUDED.last_message_at,
    updated_at = NOW()
RETURNING id`

	id := newID()
	var storedID string
	if err := r.db.QueryRowContext(
		ctx,
		query,
		id,
		chat.AccountID,
		chat.WAChatJID,
		chat.ChatType,
		chat.Title,
		chat.ParticipantCount,
		chat.Archived,
		chat.MutedUntil,
		chat.LastMessageAt,
	).Scan(&storedID); err != nil {
		return "", fmt.Errorf("upsert chat %q: %w", chat.WAChatJID, err)
	}

	return storedID, nil
}

func (r *Repository) UpsertMessage(ctx context.Context, chatID string, message NormalizedMessage) (string, error) {
	const query = `
INSERT INTO messages (
    id,
    account_id,
    chat_id,
    wa_message_id,
    sender_jid,
    from_me,
    message_type,
    text_content,
    reply_to_wa_message_id,
    sent_at,
    delivered_at,
    read_at,
    raw_payload
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
ON CONFLICT (account_id, wa_message_id)
DO UPDATE SET
    sender_jid = EXCLUDED.sender_jid,
    from_me = EXCLUDED.from_me,
    message_type = EXCLUDED.message_type,
    text_content = EXCLUDED.text_content,
    reply_to_wa_message_id = EXCLUDED.reply_to_wa_message_id,
    delivered_at = EXCLUDED.delivered_at,
    read_at = EXCLUDED.read_at,
    raw_payload = EXCLUDED.raw_payload,
    updated_at = NOW()
RETURNING id`

	id := newID()
	var storedID string
	if err := r.db.QueryRowContext(
		ctx,
		query,
		id,
		message.AccountID,
		chatID,
		message.WAMessageID,
		message.SenderJID,
		message.FromMe,
		message.MessageType,
		message.TextContent,
		message.ReplyToWAMessageID,
		message.SentAt,
		message.DeliveredAt,
		message.ReadAt,
		string(message.RawPayload),
	).Scan(&storedID); err != nil {
		return "", fmt.Errorf("upsert message %q: %w", message.WAMessageID, err)
	}

	return storedID, nil
}

func (r *Repository) ReplaceMedia(ctx context.Context, messageID string, media []MediaInput) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM media_assets WHERE message_id = $1`, messageID); err != nil {
		return fmt.Errorf("clear media for message %q: %w", messageID, err)
	}

	const query = `
INSERT INTO media_assets (
    id,
    message_id,
    media_type,
    mime_type,
    file_name,
    byte_size,
    sha256,
    storage_key,
    download_status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`

	for _, item := range media {
		if _, err := r.db.ExecContext(
			ctx,
			query,
			newID(),
			messageID,
			item.MediaType,
			item.MIMEType,
			item.FileName,
			item.ByteSize,
			item.SHA256,
			item.StorageKey,
			item.DownloadStatus,
		); err != nil {
			return fmt.Errorf("insert media for message %q: %w", messageID, err)
		}
	}

	return nil
}

func newID() string {
	return ids.NewUUID()
}

var _ storage.DBTX = (*sql.DB)(nil)
