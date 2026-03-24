package audit

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/support/ids"
)

type ActorType string

const (
	ActorTypeUser   ActorType = "user"
	ActorTypeSystem ActorType = "system"
	ActorTypeAgent  ActorType = "agent"
)

type Outcome string

const (
	OutcomeSuccess Outcome = "success"
	OutcomeDenied  Outcome = "denied"
	OutcomeBlocked Outcome = "blocked"
	OutcomeFailed  Outcome = "failed"
)

type RecordInput struct {
	ActorType  ActorType      `json:"actor_type"`
	ActorID    *string        `json:"actor_id,omitempty"`
	Action     string         `json:"action"`
	TargetType string         `json:"target_type"`
	TargetID   string         `json:"target_id"`
	Outcome    Outcome        `json:"outcome"`
	Detail     map[string]any `json:"detail,omitempty"`
}

type Entry struct {
	ID         string          `json:"id"`
	ActorType  ActorType       `json:"actor_type"`
	ActorID    *string         `json:"actor_id,omitempty"`
	Action     string          `json:"action"`
	TargetType string          `json:"target_type"`
	TargetID   string          `json:"target_id"`
	Outcome    Outcome         `json:"outcome"`
	Detail     json.RawMessage `json:"detail"`
	CreatedAt  time.Time       `json:"created_at"`
}

type ListFilters struct {
	Action     string
	TargetType string
	TargetID   string
	Outcome    Outcome
	ActorType  ActorType
	Limit      int
	Offset     int
}

type ListResult struct {
	Entries []Entry `json:"entries"`
	Total   int     `json:"total"`
	Limit   int     `json:"limit"`
	Offset  int     `json:"offset"`
}

type Service struct {
	db     *sql.DB
	logger *slog.Logger
	now    func() time.Time
}

func NewService(db *sql.DB, logger *slog.Logger) (*Service, error) {
	if db == nil {
		return nil, fmt.Errorf("audit service requires a database handle")
	}
	if logger == nil {
		logger = slog.Default()
	}

	return &Service{
		db:     db,
		logger: logger.With("component", "audit_service"),
		now:    func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *Service) Record(ctx context.Context, input RecordInput) error {
	action := strings.TrimSpace(input.Action)
	if action == "" {
		return fmt.Errorf("audit action is required")
	}

	targetType := strings.TrimSpace(input.TargetType)
	if targetType == "" {
		return fmt.Errorf("audit target_type is required")
	}

	targetID := strings.TrimSpace(input.TargetID)
	if targetID == "" {
		return fmt.Errorf("audit target_id is required")
	}

	actorType := normalizeActorType(input.ActorType)
	if actorType == "" {
		return fmt.Errorf("unsupported audit actor_type %q", input.ActorType)
	}

	outcome := normalizeOutcome(input.Outcome)
	if outcome == "" {
		return fmt.Errorf("unsupported audit outcome %q", input.Outcome)
	}

	detail := input.Detail
	if detail == nil {
		detail = map[string]any{}
	}

	payload, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("marshal audit detail: %w", err)
	}

	const query = `
INSERT INTO audit_logs (
    id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    outcome,
    detail,
    created_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`

	if _, err := s.db.ExecContext(
		ctx,
		query,
		ids.NewUUID(),
		actorType,
		normalizedOptional(input.ActorID),
		action,
		targetType,
		targetID,
		outcome,
		string(payload),
		s.now(),
	); err != nil {
		return fmt.Errorf("insert audit log for action %q: %w", action, err)
	}

	return nil
}

func (s *Service) List(ctx context.Context, filters ListFilters) (ListResult, error) {
	limit := filters.Limit
	if limit <= 0 {
		limit = 25
	}
	if limit > 200 {
		limit = 200
	}

	offset := filters.Offset
	if offset < 0 {
		offset = 0
	}

	whereClause, args, err := buildListFilters(filters)
	if err != nil {
		return ListResult{}, err
	}

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM audit_logs WHERE %s`, whereClause)
	var total int
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return ListResult{}, fmt.Errorf("count audit logs: %w", err)
	}

	query := fmt.Sprintf(`
SELECT
    id,
    actor_type,
    actor_id,
    action,
    target_type,
    target_id,
    outcome,
    detail,
    created_at
FROM audit_logs
WHERE %s
ORDER BY created_at DESC
LIMIT $%d OFFSET $%d`,
		whereClause,
		len(args)+1,
		len(args)+2,
	)

	rows, err := s.db.QueryContext(ctx, query, append(args, limit, offset)...)
	if err != nil {
		return ListResult{}, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	entries := make([]Entry, 0)
	for rows.Next() {
		var (
			item    Entry
			actorID sql.NullString
			detail  []byte
		)

		if err := rows.Scan(
			&item.ID,
			&item.ActorType,
			&actorID,
			&item.Action,
			&item.TargetType,
			&item.TargetID,
			&item.Outcome,
			&detail,
			&item.CreatedAt,
		); err != nil {
			return ListResult{}, fmt.Errorf("scan audit log row: %w", err)
		}

		item.ActorID = nullableString(actorID)
		item.Detail = json.RawMessage(detail)
		entries = append(entries, item)
	}

	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("iterate audit log rows: %w", err)
	}

	return ListResult{
		Entries: entries,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
	}, nil
}

func RequestActorID(r *http.Request) *string {
	if r == nil {
		return nil
	}

	for _, header := range []string{"X-Actor-ID", "X-User-ID"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			return &value
		}
	}

	if remoteAddr := strings.TrimSpace(r.RemoteAddr); remoteAddr != "" {
		return &remoteAddr
	}

	return nil
}

func buildListFilters(filters ListFilters) (string, []any, error) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 4)

	if action := strings.TrimSpace(filters.Action); action != "" {
		args = append(args, action)
		conditions = append(conditions, fmt.Sprintf("action = $%d", len(args)))
	}
	if targetType := strings.TrimSpace(filters.TargetType); targetType != "" {
		args = append(args, targetType)
		conditions = append(conditions, fmt.Sprintf("target_type = $%d", len(args)))
	}
	if targetID := strings.TrimSpace(filters.TargetID); targetID != "" {
		args = append(args, targetID)
		conditions = append(conditions, fmt.Sprintf("target_id = $%d", len(args)))
	}
	if filters.Outcome != "" {
		outcome := normalizeOutcome(filters.Outcome)
		if outcome == "" {
			return "", nil, fmt.Errorf("unsupported audit outcome %q", filters.Outcome)
		}
		args = append(args, outcome)
		conditions = append(conditions, fmt.Sprintf("outcome = $%d", len(args)))
	}
	if filters.ActorType != "" {
		actorType := normalizeActorType(filters.ActorType)
		if actorType == "" {
			return "", nil, fmt.Errorf("unsupported audit actor_type %q", filters.ActorType)
		}
		args = append(args, actorType)
		conditions = append(conditions, fmt.Sprintf("actor_type = $%d", len(args)))
	}

	return strings.Join(conditions, " AND "), args, nil
}

func normalizeActorType(value ActorType) ActorType {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(ActorTypeUser):
		return ActorTypeUser
	case string(ActorTypeSystem):
		return ActorTypeSystem
	case string(ActorTypeAgent):
		return ActorTypeAgent
	default:
		return ""
	}
}

func normalizeOutcome(value Outcome) Outcome {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(OutcomeSuccess):
		return OutcomeSuccess
	case string(OutcomeDenied):
		return OutcomeDenied
	case string(OutcomeBlocked):
		return OutcomeBlocked
	case string(OutcomeFailed):
		return OutcomeFailed
	default:
		return ""
	}
}

func normalizedOptional(value *string) *string {
	if value == nil {
		return nil
	}

	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func nullableString(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}
