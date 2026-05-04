package exports

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/storage"
)

type Repository struct {
	db storage.DBTX
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("export repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) Create(ctx context.Context, job ExportJob) error {
	const query = `
INSERT INTO export_jobs (
    id,
    account_id,
    chat_id,
    account_ids_json,
    chat_ids_json,
    date_from,
    date_to,
    scope_type,
    format,
    include_media,
    status,
    artifact_path,
    error_message,
    started_at,
    completed_at
 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		job.ID,
		job.AccountID,
		job.ChatID,
		marshalStringSliceJSON(job.AccountIDs),
		marshalStringSliceJSON(job.ChatIDs),
		job.DateFrom,
		job.DateTo,
		job.ScopeType,
		job.Format,
		job.IncludeMedia,
		job.Status,
		job.ArtifactPath,
		job.ErrorMessage,
		job.StartedAt,
		job.CompletedAt,
	); err != nil {
		return fmt.Errorf("create export job %q: %w", job.ID, err)
	}

	return nil
}

func (r *Repository) GetByID(ctx context.Context, id string) (ExportJob, error) {
	const baseQuery = `
SELECT
    id,
    account_id,
    chat_id,
    account_ids_json,
    chat_ids_json,
    date_from,
    date_to,
    scope_type,
    format,
    include_media,
    status,
    artifact_path,
    error_message,
    created_at,
    started_at,
    completed_at
FROM export_jobs
WHERE id = $1%s`

	scopeClause, scopeArgs := exportAccountScope(ctx, "account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	var (
		job          ExportJob
		accountIDs   []byte
		chatIDs      []byte
		dateFrom     sql.NullTime
		dateTo       sql.NullTime
		artifactPath sql.NullString
		errorMessage sql.NullString
		startedAt    sql.NullTime
		completedAt  sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&job.ID,
		&job.AccountID,
		&job.ChatID,
		&accountIDs,
		&chatIDs,
		&dateFrom,
		&dateTo,
		&job.ScopeType,
		&job.Format,
		&job.IncludeMedia,
		&job.Status,
		&artifactPath,
		&errorMessage,
		&job.CreatedAt,
		&startedAt,
		&completedAt,
	); err != nil {
		return ExportJob{}, fmt.Errorf("get export job %q: %w", id, err)
	}

	job.AccountIDs = decodeStringSliceJSON(accountIDs, job.AccountID)
	job.ChatIDs = decodeStringSliceJSON(chatIDs, job.ChatID)
	job.DateFrom = nullableTime(dateFrom)
	job.DateTo = nullableTime(dateTo)
	job.ArtifactPath = nullableString(artifactPath)
	job.ErrorMessage = nullableString(errorMessage)
	job.StartedAt = nullableTime(startedAt)
	job.CompletedAt = nullableTime(completedAt)

	return job, nil
}

func (r *Repository) List(ctx context.Context) ([]ExportJob, error) {
	const baseQuery = `
SELECT
    id,
    account_id,
    chat_id,
    account_ids_json,
    chat_ids_json,
    date_from,
    date_to,
    scope_type,
    format,
    include_media,
    status,
    artifact_path,
    error_message,
    created_at,
    started_at,
    completed_at
FROM export_jobs
WHERE 1 = 1%s
ORDER BY created_at DESC`

	scopeClause, scopeArgs := exportAccountScope(ctx, "account_id", 1)
	query := fmt.Sprintf(baseQuery, scopeClause)

	rows, err := r.db.QueryContext(ctx, query, scopeArgs...)
	if err != nil {
		return nil, fmt.Errorf("list export jobs: %w", err)
	}
	defer rows.Close()

	items := make([]ExportJob, 0)
	for rows.Next() {
		var (
			job          ExportJob
			accountIDs   []byte
			chatIDs      []byte
			dateFrom     sql.NullTime
			dateTo       sql.NullTime
			artifactPath sql.NullString
			errorMessage sql.NullString
			startedAt    sql.NullTime
			completedAt  sql.NullTime
		)

		if err := rows.Scan(
			&job.ID,
			&job.AccountID,
			&job.ChatID,
			&accountIDs,
			&chatIDs,
			&dateFrom,
			&dateTo,
			&job.ScopeType,
			&job.Format,
			&job.IncludeMedia,
			&job.Status,
			&artifactPath,
			&errorMessage,
			&job.CreatedAt,
			&startedAt,
			&completedAt,
		); err != nil {
			return nil, fmt.Errorf("scan export job row: %w", err)
		}

		job.AccountIDs = decodeStringSliceJSON(accountIDs, job.AccountID)
		job.ChatIDs = decodeStringSliceJSON(chatIDs, job.ChatID)
		job.DateFrom = nullableTime(dateFrom)
		job.DateTo = nullableTime(dateTo)
		job.ArtifactPath = nullableString(artifactPath)
		job.ErrorMessage = nullableString(errorMessage)
		job.StartedAt = nullableTime(startedAt)
		job.CompletedAt = nullableTime(completedAt)

		items = append(items, job)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate export jobs: %w", err)
	}

	return items, nil
}

func (r *Repository) Delete(ctx context.Context, id string) error {
	const baseQuery = `DELETE FROM export_jobs WHERE id = $1%s`
	scopeClause, scopeArgs := exportAccountScope(ctx, "account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("delete export job %q: %w", id, err)
	}

	if rows, rowsErr := result.RowsAffected(); rowsErr == nil && rows == 0 {
		return sql.ErrNoRows
	}

	return nil
}

func exportAccountScope(ctx context.Context, accountColumn string, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(` AND EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = export_jobs.%s
      AND account_scope.user_id = $%d
) AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements_text(COALESCE(export_jobs.account_ids_json, jsonb_build_array(export_jobs.%s::text))) AS scoped_account(account_id)
    LEFT JOIN accounts account_scope_all ON account_scope_all.id = scoped_account.account_id::uuid
    WHERE account_scope_all.user_id IS DISTINCT FROM $%d
)`, strings.TrimSpace(accountColumn), startIndex, strings.TrimSpace(accountColumn), startIndex), []any{currentUser.ID}
}

func (r *Repository) MarkRunning(ctx context.Context, id string, startedAt time.Time) error {
	const query = `
UPDATE export_jobs
SET
    status = 'running',
    started_at = $2,
    error_message = NULL
WHERE id = $1`

	if _, err := r.db.ExecContext(ctx, query, id, startedAt); err != nil {
		return fmt.Errorf("mark export job %q running: %w", id, err)
	}

	return nil
}

func (r *Repository) MarkCompleted(ctx context.Context, id string, artifactPath string, completedAt time.Time) error {
	const query = `
UPDATE export_jobs
SET
    status = 'completed',
    artifact_path = $2,
    completed_at = $3,
    error_message = NULL
WHERE id = $1`

	if _, err := r.db.ExecContext(ctx, query, id, artifactPath, completedAt); err != nil {
		return fmt.Errorf("mark export job %q completed: %w", id, err)
	}

	return nil
}

func (r *Repository) MarkFailed(ctx context.Context, id string, message string, completedAt time.Time) error {
	const query = `
UPDATE export_jobs
SET
    status = 'failed',
    error_message = $2,
    completed_at = $3
WHERE id = $1`

	if _, err := r.db.ExecContext(ctx, query, id, message, completedAt); err != nil {
		return fmt.Errorf("mark export job %q failed: %w", id, err)
	}

	return nil
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time
	return &result
}

func marshalStringSliceJSON(values []string) []byte {
	if len(values) == 0 {
		return []byte("[]")
	}

	payload, err := json.Marshal(values)
	if err != nil {
		return []byte("[]")
	}

	return payload
}

func decodeStringSliceJSON(raw []byte, fallback string) []string {
	if len(raw) > 0 {
		var values []string
		if err := json.Unmarshal(raw, &values); err == nil && len(values) > 0 {
			return values
		}
	}

	if fallback == "" {
		return []string{}
	}

	return []string{fallback}
}
