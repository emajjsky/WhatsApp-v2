package agents

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/storage"
)

type Repository struct {
	db storage.DBTX
}

func NewRepository(db storage.DBTX) (*Repository, error) {
	if db == nil {
		return nil, fmt.Errorf("agent repository requires a database handle")
	}

	return &Repository{db: db}, nil
}

func (r *Repository) CreateRule(ctx context.Context, rule AgentRule) error {
	scopeFilter, err := mustMarshalJSON(rule.ScopeFilter)
	if err != nil {
		return err
	}
	triggerFilter, err := mustMarshalJSON(rule.TriggerFilter)
	if err != nil {
		return err
	}
	blacklistFilter, err := mustMarshalJSON(rule.BlacklistFilter)
	if err != nil {
		return err
	}
	knowledgeBinding, err := marshalNullableJSON(rule.KnowledgeBinding)
	if err != nil {
		return err
	}
	providerConfig, err := mustMarshalJSON(defaultJSONMap(rule.ProviderConfig))
	if err != nil {
		return err
	}

	const query = `
INSERT INTO agent_rules (
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		rule.ID,
		rule.AccountID,
		rule.Name,
		rule.Enabled,
		scopeFilter,
		triggerFilter,
		rule.ReplyMode,
		rule.CooldownSeconds,
		rule.MaxAutoRepliesPerThread,
		blacklistFilter,
		rule.PromptTemplate,
		providerConfig,
		knowledgeBinding,
	); err != nil {
		return fmt.Errorf("create agent rule %q: %w", rule.ID, err)
	}

	return nil
}

func (r *Repository) UpdateRule(ctx context.Context, rule AgentRule) error {
	scopeFilter, err := mustMarshalJSON(rule.ScopeFilter)
	if err != nil {
		return err
	}
	triggerFilter, err := mustMarshalJSON(rule.TriggerFilter)
	if err != nil {
		return err
	}
	blacklistFilter, err := mustMarshalJSON(rule.BlacklistFilter)
	if err != nil {
		return err
	}
	knowledgeBinding, err := marshalNullableJSON(rule.KnowledgeBinding)
	if err != nil {
		return err
	}
	providerConfig, err := mustMarshalJSON(defaultJSONMap(rule.ProviderConfig))
	if err != nil {
		return err
	}

	const query = `
UPDATE agent_rules
SET
    account_id = $2,
    name = $3,
    enabled = $4,
    scope_filter = $5,
    trigger_filter = $6,
    reply_mode = $7,
    cooldown_seconds = $8,
    max_auto_replies_per_thread = $9,
    blacklist_filter = $10,
    prompt_template = $11,
    provider_config = $12,
    knowledge_binding = $13,
    updated_at = NOW()
WHERE id = $1`

	result, err := r.db.ExecContext(
		ctx,
		query,
		rule.ID,
		rule.AccountID,
		rule.Name,
		rule.Enabled,
		scopeFilter,
		triggerFilter,
		rule.ReplyMode,
		rule.CooldownSeconds,
		rule.MaxAutoRepliesPerThread,
		blacklistFilter,
		rule.PromptTemplate,
		providerConfig,
		knowledgeBinding,
	)
	if err != nil {
		return fmt.Errorf("update agent rule %q: %w", rule.ID, err)
	}

	return ensureAffected(result, rule.ID)
}

func (r *Repository) GetRuleByID(ctx context.Context, id string) (AgentRule, error) {
	const query = `
SELECT
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding,
    created_at,
    updated_at
FROM agent_rules
WHERE id = $1`

	var (
		rule             AgentRule
		scopeFilter      []byte
		triggerFilter    []byte
		blacklistFilter  []byte
		providerConfig   []byte
		knowledgeBinding []byte
	)

	if err := r.db.QueryRowContext(ctx, query, id).Scan(
		&rule.ID,
		&rule.AccountID,
		&rule.Name,
		&rule.Enabled,
		&scopeFilter,
		&triggerFilter,
		&rule.ReplyMode,
		&rule.CooldownSeconds,
		&rule.MaxAutoRepliesPerThread,
		&blacklistFilter,
		&rule.PromptTemplate,
		&providerConfig,
		&knowledgeBinding,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return AgentRule{}, fmt.Errorf("get agent rule %q: %w", id, err)
	}

	if err := decodeRuleFilters(&rule, scopeFilter, triggerFilter, blacklistFilter, providerConfig, knowledgeBinding); err != nil {
		return AgentRule{}, err
	}

	return rule, nil
}

func (r *Repository) ListRules(ctx context.Context, filters RuleListFilters) ([]AgentRule, error) {
	whereClause, args := buildRuleWhere(filters)

	query := fmt.Sprintf(`
SELECT
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding,
    created_at,
    updated_at
FROM agent_rules
WHERE %s
ORDER BY enabled DESC, updated_at DESC, id DESC`, whereClause)

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list agent rules: %w", err)
	}
	defer rows.Close()

	items := make([]AgentRule, 0)
	for rows.Next() {
		var (
			rule             AgentRule
			scopeFilter      []byte
			triggerFilter    []byte
			blacklistFilter  []byte
			providerConfig   []byte
			knowledgeBinding []byte
		)

		if err := rows.Scan(
			&rule.ID,
			&rule.AccountID,
			&rule.Name,
			&rule.Enabled,
			&scopeFilter,
			&triggerFilter,
			&rule.ReplyMode,
			&rule.CooldownSeconds,
			&rule.MaxAutoRepliesPerThread,
			&blacklistFilter,
			&rule.PromptTemplate,
			&providerConfig,
			&knowledgeBinding,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan agent rule row: %w", err)
		}

		if err := decodeRuleFilters(&rule, scopeFilter, triggerFilter, blacklistFilter, providerConfig, knowledgeBinding); err != nil {
			return nil, err
		}

		items = append(items, rule)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent rule rows: %w", err)
	}

	return items, nil
}

func (r *Repository) SetRuleEnabled(ctx context.Context, id string, enabled bool) error {
	const query = `
UPDATE agent_rules
SET
    enabled = $2,
    updated_at = NOW()
WHERE id = $1`

	result, err := r.db.ExecContext(ctx, query, id, enabled)
	if err != nil {
		return fmt.Errorf("update agent rule %q enabled state: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) DeleteRule(ctx context.Context, id string) error {
	const query = `DELETE FROM agent_rules WHERE id = $1`

	result, err := r.db.ExecContext(ctx, query, id)
	if err != nil {
		return fmt.Errorf("delete agent rule %q: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) UpsertSettings(ctx context.Context, settings AgentSettings) error {
	const query = `
INSERT INTO agent_settings (
    account_id,
    provider,
    model,
    base_url,
    api_key,
    prompt_template
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (account_id) DO UPDATE
SET
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    base_url = EXCLUDED.base_url,
    api_key = EXCLUDED.api_key,
    prompt_template = EXCLUDED.prompt_template,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		settings.AccountID,
		settings.Provider,
		settings.Model,
		settings.BaseURL,
		settings.APIKey,
		settings.PromptTemplate,
	); err != nil {
		return fmt.Errorf("upsert agent settings for account %q: %w", settings.AccountID, err)
	}

	return nil
}

func (r *Repository) GetSettings(ctx context.Context, accountID string) (AgentSettings, error) {
	const query = `
SELECT
    account_id,
    provider,
    model,
    base_url,
    api_key,
    prompt_template,
    created_at,
    updated_at
FROM agent_settings
WHERE account_id = $1`

	var settings AgentSettings
	if err := r.db.QueryRowContext(ctx, query, accountID).Scan(
		&settings.AccountID,
		&settings.Provider,
		&settings.Model,
		&settings.BaseURL,
		&settings.APIKey,
		&settings.PromptTemplate,
		&settings.CreatedAt,
		&settings.UpdatedAt,
	); err != nil {
		return AgentSettings{}, fmt.Errorf("get agent settings for account %q: %w", accountID, err)
	}

	return settings, nil
}

func (r *Repository) CreateRun(ctx context.Context, run AgentRun) error {
	if len(run.InputContext) == 0 {
		run.InputContext = json.RawMessage(`{}`)
	}

	const query = `
INSERT INTO agent_runs (
    id,
    rule_id,
    account_id,
    chat_id,
    trigger_message_id,
    status,
    input_context,
    output_draft,
    block_reason,
    sent_message_id,
    completed_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		run.ID,
		run.RuleID,
		run.AccountID,
		run.ChatID,
		run.TriggerMessageID,
		run.Status,
		run.InputContext,
		run.OutputDraft,
		run.BlockReason,
		run.SentMessageID,
		run.CompletedAt,
	); err != nil {
		return fmt.Errorf("create agent run %q: %w", run.ID, err)
	}

	return nil
}

func (r *Repository) UpdateRunStatus(ctx context.Context, id string, update RunStatusUpdate) error {
	const query = `
UPDATE agent_runs
SET
    status = $2,
    output_draft = $3,
    block_reason = $4,
    sent_message_id = $5,
    completed_at = $6
WHERE id = $1`

	result, err := r.db.ExecContext(
		ctx,
		query,
		id,
		update.Status,
		update.OutputDraft,
		update.BlockReason,
		update.SentMessageID,
		update.CompletedAt,
	)
	if err != nil {
		return fmt.Errorf("update agent run %q: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) GetRunIDByRuleAndTriggerMessage(ctx context.Context, ruleID, triggerMessageID string) (string, error) {
	const query = `
SELECT id
FROM agent_runs
WHERE rule_id = $1 AND trigger_message_id = $2
ORDER BY created_at DESC, id DESC
LIMIT 1`

	var runID string
	if err := r.db.QueryRowContext(ctx, query, ruleID, triggerMessageID).Scan(&runID); err != nil {
		return "", fmt.Errorf("get agent run id for rule %q and trigger message %q: %w", ruleID, triggerMessageID, err)
	}

	return runID, nil
}

func (r *Repository) CountSentRunsSince(ctx context.Context, ruleID, chatID string, since time.Time) (int, error) {
	const query = `
SELECT COUNT(*)
FROM agent_runs
WHERE rule_id = $1
  AND chat_id = $2
  AND status = 'sent'
  AND created_at >= $3`

	var count int
	if err := r.db.QueryRowContext(ctx, query, ruleID, chatID, since).Scan(&count); err != nil {
		return 0, fmt.Errorf("count sent agent runs for rule %q: %w", ruleID, err)
	}

	return count, nil
}

func (r *Repository) GetLastSentRunAt(ctx context.Context, ruleID, chatID string) (*time.Time, error) {
	const query = `
SELECT created_at
FROM agent_runs
WHERE rule_id = $1
  AND chat_id = $2
  AND status = 'sent'
ORDER BY created_at DESC, id DESC
LIMIT 1`

	var createdAt time.Time
	if err := r.db.QueryRowContext(ctx, query, ruleID, chatID).Scan(&createdAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get last sent agent run for rule %q: %w", ruleID, err)
	}

	return &createdAt, nil
}

func (r *Repository) GetRunViewByID(ctx context.Context, id string) (RunView, error) {
	const query = `
SELECT
    ar.id,
    ar.rule_id,
    rules.name,
    ar.account_id,
    ar.chat_id,
    chats.title,
    chats.wa_chat_jid,
    ar.trigger_message_id,
    trigger_message.text_content,
    ar.status,
    ar.output_draft,
    ar.block_reason,
    ar.created_at,
    ar.completed_at
FROM agent_runs ar
JOIN agent_rules rules ON rules.id = ar.rule_id
LEFT JOIN chats ON chats.id = ar.chat_id
LEFT JOIN messages trigger_message ON trigger_message.id = ar.trigger_message_id
WHERE ar.id = $1`

	var (
		item           RunView
		chatTitle      sql.NullString
		waChatJID      sql.NullString
		triggerPreview sql.NullString
		outputDraft    sql.NullString
		blockReason    sql.NullString
		completedAt    sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, id).Scan(
		&item.ID,
		&item.RuleID,
		&item.RuleName,
		&item.AccountID,
		&item.ChatID,
		&chatTitle,
		&waChatJID,
		&item.TriggerMessageID,
		&triggerPreview,
		&item.Status,
		&outputDraft,
		&blockReason,
		&item.CreatedAt,
		&completedAt,
	); err != nil {
		return RunView{}, fmt.Errorf("get agent run %q: %w", id, err)
	}

	item.ChatTitle = nullableString(chatTitle)
	item.WAChatJID = nullableString(waChatJID)
	item.TriggerPreview = nullableString(triggerPreview)
	item.OutputDraft = nullableString(outputDraft)
	item.BlockReason = nullableString(blockReason)
	item.CompletedAt = nullableTime(completedAt)

	return item, nil
}

func (r *Repository) ListRuns(ctx context.Context, filters RunListFilters) ([]RunView, int, error) {
	whereClause, args := buildRunWhere(filters)

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM agent_runs ar WHERE %s`, whereClause)
	var total int
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count agent runs: %w", err)
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, filters.Limit, filters.Offset)
	limitIndex := len(args) + 1
	offsetIndex := len(args) + 2

	query := fmt.Sprintf(`
SELECT
    ar.id,
    ar.rule_id,
    rules.name,
    ar.account_id,
    ar.chat_id,
    chats.title,
    chats.wa_chat_jid,
    ar.trigger_message_id,
    trigger_message.text_content,
    ar.status,
    ar.output_draft,
    ar.block_reason,
    ar.created_at,
    ar.completed_at
FROM agent_runs ar
JOIN agent_rules rules ON rules.id = ar.rule_id
LEFT JOIN chats ON chats.id = ar.chat_id
LEFT JOIN messages trigger_message ON trigger_message.id = ar.trigger_message_id
WHERE %s
ORDER BY ar.created_at DESC, ar.id DESC
LIMIT $%d OFFSET $%d`, whereClause, limitIndex, offsetIndex)

	rows, err := r.db.QueryContext(ctx, query, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list agent runs: %w", err)
	}
	defer rows.Close()

	items := make([]RunView, 0, filters.Limit)
	for rows.Next() {
		var (
			item           RunView
			chatTitle      sql.NullString
			waChatJID      sql.NullString
			triggerPreview sql.NullString
			outputDraft    sql.NullString
			blockReason    sql.NullString
			completedAt    sql.NullTime
		)

		if err := rows.Scan(
			&item.ID,
			&item.RuleID,
			&item.RuleName,
			&item.AccountID,
			&item.ChatID,
			&chatTitle,
			&waChatJID,
			&item.TriggerMessageID,
			&triggerPreview,
			&item.Status,
			&outputDraft,
			&blockReason,
			&item.CreatedAt,
			&completedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan agent run row: %w", err)
		}

		item.ChatTitle = nullableString(chatTitle)
		item.WAChatJID = nullableString(waChatJID)
		item.TriggerPreview = nullableString(triggerPreview)
		item.OutputDraft = nullableString(outputDraft)
		item.BlockReason = nullableString(blockReason)
		item.CompletedAt = nullableTime(completedAt)

		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate agent run rows: %w", err)
	}

	return items, total, nil
}

func buildRuleWhere(filters RuleListFilters) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 2)

	if filters.AccountID != "" {
		args = append(args, filters.AccountID)
		conditions = append(conditions, fmt.Sprintf("account_id = $%d", len(args)))
	}
	if filters.Enabled != nil {
		args = append(args, *filters.Enabled)
		conditions = append(conditions, fmt.Sprintf("enabled = $%d", len(args)))
	}

	return strings.Join(conditions, " AND "), args
}

func buildRunWhere(filters RunListFilters) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 4)

	if filters.AccountID != "" {
		args = append(args, filters.AccountID)
		conditions = append(conditions, fmt.Sprintf("ar.account_id = $%d", len(args)))
	}
	if filters.RuleID != "" {
		args = append(args, filters.RuleID)
		conditions = append(conditions, fmt.Sprintf("ar.rule_id = $%d", len(args)))
	}
	if filters.ChatID != "" {
		args = append(args, filters.ChatID)
		conditions = append(conditions, fmt.Sprintf("ar.chat_id = $%d", len(args)))
	}
	if filters.Status != "" {
		args = append(args, filters.Status)
		conditions = append(conditions, fmt.Sprintf("ar.status = $%d", len(args)))
	}

	return strings.Join(conditions, " AND "), args
}

func decodeRuleFilters(
	rule *AgentRule,
	scopeFilter []byte,
	triggerFilter []byte,
	blacklistFilter []byte,
	providerConfig []byte,
	knowledgeBinding []byte,
) error {
	if err := unmarshalOrDefault(scopeFilter, &rule.ScopeFilter); err != nil {
		return fmt.Errorf("decode rule %q scope filter: %w", rule.ID, err)
	}
	if err := unmarshalOrDefault(triggerFilter, &rule.TriggerFilter); err != nil {
		return fmt.Errorf("decode rule %q trigger filter: %w", rule.ID, err)
	}
	if err := unmarshalOrDefault(blacklistFilter, &rule.BlacklistFilter); err != nil {
		return fmt.Errorf("decode rule %q blacklist filter: %w", rule.ID, err)
	}
	if err := unmarshalOrDefault(providerConfig, &rule.ProviderConfig); err != nil {
		return fmt.Errorf("decode rule %q provider config: %w", rule.ID, err)
	}
	if rule.ProviderConfig == nil {
		rule.ProviderConfig = make(map[string]any)
	}
	if len(knowledgeBinding) == 0 {
		rule.KnowledgeBinding = nil
		return nil
	}

	var binding KnowledgeBinding
	if err := json.Unmarshal(knowledgeBinding, &binding); err != nil {
		return fmt.Errorf("decode rule %q knowledge binding: %w", rule.ID, err)
	}
	rule.KnowledgeBinding = &binding

	return nil
}

func mustMarshalJSON(value any) ([]byte, error) {
	body, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal json value: %w", err)
	}

	return body, nil
}

func defaultJSONMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}

	return value
}

func marshalNullableJSON(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	reflected := reflect.ValueOf(value)
	if reflected.Kind() == reflect.Ptr && reflected.IsNil() {
		return nil, nil
	}

	body, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("marshal nullable json value: %w", err)
	}

	return body, nil
}

func unmarshalOrDefault(body []byte, target any) error {
	if len(body) == 0 {
		return nil
	}

	return json.Unmarshal(body, target)
}

func ensureAffected(result sql.Result, id string) error {
	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("read rows affected for %q: %w", id, err)
	}
	if rowsAffected == 0 {
		return sql.ErrNoRows
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
