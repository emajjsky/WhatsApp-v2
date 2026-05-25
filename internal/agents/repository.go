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

	"whatsapp-agent-platform/internal/auth"
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
    purpose,
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
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		rule.ID,
		rule.AccountID,
		rule.Purpose,
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

	if err := r.syncRuleAccounts(ctx, rule.ID, rule.AccountID, rule.AccountIDs); err != nil {
		return err
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
    purpose = $3,
    name = $4,
    enabled = $5,
    scope_filter = $6,
    trigger_filter = $7,
    reply_mode = $8,
    cooldown_seconds = $9,
    max_auto_replies_per_thread = $10,
    blacklist_filter = $11,
    prompt_template = $12,
    provider_config = $13,
    knowledge_binding = $14,
    updated_at = NOW()
WHERE id = $1`

	result, err := r.db.ExecContext(
		ctx,
		query,
		rule.ID,
		rule.AccountID,
		rule.Purpose,
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

	if err := ensureAffected(result, rule.ID); err != nil {
		return err
	}

	return r.syncRuleAccounts(ctx, rule.ID, rule.AccountID, rule.AccountIDs)
}

func (r *Repository) GetRuleByID(ctx context.Context, id string) (AgentRule, error) {
	const baseQuery = `
SELECT
    ar.id,
    ar.account_id,
    ar.purpose,
    ar.name,
    ar.enabled,
    ar.scope_filter,
    ar.trigger_filter,
    ar.reply_mode,
    ar.cooldown_seconds,
    ar.max_auto_replies_per_thread,
    ar.blacklist_filter,
    ar.prompt_template,
    ar.provider_config,
    ar.knowledge_binding,
    COALESCE(accounts.account_ids, jsonb_build_array(ar.account_id::text)) AS account_ids,
    ar.created_at,
    ar.updated_at
FROM agent_rules ar
LEFT JOIN LATERAL (
    SELECT jsonb_agg(ara.account_id::text ORDER BY ara.account_id::text) AS account_ids
    FROM agent_rule_accounts ara
    WHERE ara.rule_id = ar.id
) AS accounts ON TRUE
WHERE ar.id = $1`

	scopeClause, scopeArgs := agentAccountScope(ctx, "ar.account_id", 2)
	query := baseQuery + scopeClause
	args := append([]any{id}, scopeArgs...)

	var (
		rule             AgentRule
		scopeFilter      []byte
		triggerFilter    []byte
		blacklistFilter  []byte
		providerConfig   []byte
		knowledgeBinding []byte
		accountIDs       []byte
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&rule.ID,
		&rule.AccountID,
		&rule.Purpose,
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
		&accountIDs,
		&rule.CreatedAt,
		&rule.UpdatedAt,
	); err != nil {
		return AgentRule{}, fmt.Errorf("get agent rule %q: %w", id, err)
	}

	if err := decodeRuleFilters(&rule, scopeFilter, triggerFilter, blacklistFilter, providerConfig, knowledgeBinding, accountIDs); err != nil {
		return AgentRule{}, err
	}

	return rule, nil
}

func (r *Repository) ListRules(ctx context.Context, filters RuleListFilters) ([]AgentRule, error) {
	whereClause, args := buildRuleWhere(ctx, filters)

	query := fmt.Sprintf(`
SELECT
    ar.id,
    ar.account_id,
    ar.purpose,
    ar.name,
    ar.enabled,
    ar.scope_filter,
    ar.trigger_filter,
    ar.reply_mode,
    ar.cooldown_seconds,
    ar.max_auto_replies_per_thread,
    ar.blacklist_filter,
    ar.prompt_template,
    ar.provider_config,
    ar.knowledge_binding,
    COALESCE(accounts.account_ids, jsonb_build_array(ar.account_id::text)) AS account_ids,
    ar.created_at,
    ar.updated_at
FROM agent_rules ar
LEFT JOIN LATERAL (
    SELECT jsonb_agg(ara.account_id::text ORDER BY ara.account_id::text) AS account_ids
    FROM agent_rule_accounts ara
    WHERE ara.rule_id = ar.id
) AS accounts ON TRUE
WHERE %s
ORDER BY ar.enabled DESC, ar.updated_at DESC, ar.id DESC`, whereClause)

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
			accountIDs       []byte
		)

		if err := rows.Scan(
			&rule.ID,
			&rule.AccountID,
			&rule.Purpose,
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
			&accountIDs,
			&rule.CreatedAt,
			&rule.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan agent rule row: %w", err)
		}

		if err := decodeRuleFilters(&rule, scopeFilter, triggerFilter, blacklistFilter, providerConfig, knowledgeBinding, accountIDs); err != nil {
			return nil, err
		}

		items = append(items, rule)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent rule rows: %w", err)
	}

	return items, nil
}

func (r *Repository) FindRuleByPurposeAndAccount(ctx context.Context, purpose AgentPurpose, accountID string) (AgentRule, error) {
	filters := RuleListFilters{
		AccountID: strings.TrimSpace(accountID),
		Enabled:   boolPointer(true),
	}
	rules, err := r.ListRules(ctx, filters)
	if err != nil {
		return AgentRule{}, err
	}

	for _, rule := range rules {
		if rule.Purpose == purpose {
			return rule, nil
		}
	}

	return AgentRule{}, sql.ErrNoRows
}

func (r *Repository) SetRuleEnabled(ctx context.Context, id string, enabled bool) error {
	const baseQuery = `
UPDATE agent_rules
SET
    enabled = $2,
    updated_at = NOW()
WHERE id = $1%s`

	scopeClause, scopeArgs := agentAccountScope(ctx, "account_id", 3)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id, enabled}, scopeArgs...)

	result, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("update agent rule %q enabled state: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) DeleteRule(ctx context.Context, id string) error {
	const baseQuery = `DELETE FROM agent_rules WHERE id = $1%s`
	scopeClause, scopeArgs := agentAccountScope(ctx, "account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	result, err := r.db.ExecContext(ctx, query, args...)
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
	const baseQuery = `
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
WHERE account_id = $1%s`

	scopeClause, scopeArgs := agentAccountScope(ctx, "account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{accountID}, scopeArgs...)

	var settings AgentSettings
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
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

func (r *Repository) ListSystemConfigs(ctx context.Context) ([]SystemAgentConfig, error) {
	const query = `
SELECT
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
FROM system_agents
ORDER BY purpose ASC, name ASC, created_at DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list system agent configs: %w", err)
	}
	defer rows.Close()

	items := make([]SystemAgentConfig, 0)
	for rows.Next() {
		item, err := scanSystemConfig(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate system agent configs: %w", err)
	}

	if err := r.attachSkillIDs(ctx, items); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *Repository) ListEnabledSystemConfigs(ctx context.Context, purpose AgentPurpose) ([]SystemAgentConfig, error) {
	const query = `
SELECT
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
FROM system_agents
WHERE enabled = TRUE
  AND ($1 = '' OR purpose = $1)
ORDER BY purpose ASC, name ASC, created_at DESC`

	rows, err := r.db.QueryContext(ctx, query, strings.TrimSpace(string(purpose)))
	if err != nil {
		return nil, fmt.Errorf("list enabled system agent configs: %w", err)
	}
	defer rows.Close()

	items := make([]SystemAgentConfig, 0)
	for rows.Next() {
		item, err := scanSystemConfig(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate enabled system agent configs: %w", err)
	}

	if err := r.attachSkillIDs(ctx, items); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *Repository) GetSystemConfig(ctx context.Context, purpose AgentPurpose) (SystemAgentConfig, error) {
	const query = `
SELECT
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
FROM system_agents
WHERE purpose = $1
  AND enabled = TRUE
ORDER BY name ASC, created_at DESC
LIMIT 1`

	item, err := scanSystemConfig(r.db.QueryRowContext(ctx, query, purpose))
	if err != nil {
		return SystemAgentConfig{}, err
	}
	items := []SystemAgentConfig{item}
	if err := r.attachSkillIDs(ctx, items); err != nil {
		return SystemAgentConfig{}, err
	}
	return items[0], nil
}

func (r *Repository) GetSystemConfigByID(ctx context.Context, id string, purpose AgentPurpose) (SystemAgentConfig, error) {
	const query = `
SELECT
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template,
    created_at,
    updated_at
FROM system_agents
WHERE id = $1
  AND ($2 = '' OR purpose = $2)`

	item, err := scanSystemConfig(r.db.QueryRowContext(ctx, query, strings.TrimSpace(id), strings.TrimSpace(string(purpose))))
	if err != nil {
		return SystemAgentConfig{}, err
	}
	items := []SystemAgentConfig{item}
	if err := r.attachSkillIDs(ctx, items); err != nil {
		return SystemAgentConfig{}, err
	}
	return items[0], nil
}

func (r *Repository) UpsertSystemConfig(ctx context.Context, config SystemAgentConfig) error {
	providerConfig, err := mustMarshalJSON(defaultJSONMap(config.ProviderConfig))
	if err != nil {
		return err
	}

	const query = `
INSERT INTO system_agents (
    id,
    name,
    purpose,
    enabled,
    provider_config,
    prompt_template
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    purpose = EXCLUDED.purpose,
    enabled = EXCLUDED.enabled,
    provider_config = EXCLUDED.provider_config,
    prompt_template = EXCLUDED.prompt_template,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		config.ID,
		config.Name,
		config.Purpose,
		config.Enabled,
		providerConfig,
		config.PromptTemplate,
	); err != nil {
		return fmt.Errorf("upsert system agent config %q: %w", config.ID, err)
	}

	return r.SyncSystemConfigSkills(ctx, config.ID, config.SkillIDs)
}

func (r *Repository) SyncSystemConfigSkills(ctx context.Context, agentID string, skillIDs []string) error {
	trimmedAgentID := strings.TrimSpace(agentID)
	if trimmedAgentID == "" {
		return fmt.Errorf("agent id is required")
	}

	if _, err := r.db.ExecContext(ctx, `DELETE FROM system_agent_skill_bindings WHERE agent_id = $1`, trimmedAgentID); err != nil {
		return fmt.Errorf("clear agent skill bindings for %q: %w", trimmedAgentID, err)
	}

	normalized := normalizeStringList(skillIDs)
	for index, skillID := range normalized {
		if _, err := r.db.ExecContext(
			ctx,
			`INSERT INTO system_agent_skill_bindings (agent_id, skill_id, sort_order)
             VALUES ($1, $2, $3)
             ON CONFLICT (agent_id, skill_id) DO UPDATE
             SET sort_order = EXCLUDED.sort_order`,
			trimmedAgentID,
			skillID,
			index,
		); err != nil {
			return fmt.Errorf("bind skill %q to agent %q: %w", skillID, trimmedAgentID, err)
		}
	}

	return nil
}

func (r *Repository) DisableOtherSystemConfigs(ctx context.Context, purpose AgentPurpose, activeID string) error {
	const query = `
UPDATE system_agents
SET
    enabled = FALSE,
    updated_at = NOW()
WHERE purpose = $1
  AND id <> $2
  AND enabled = TRUE`

	if _, err := r.db.ExecContext(ctx, query, purpose, strings.TrimSpace(activeID)); err != nil {
		return fmt.Errorf("disable other %s system agent configs: %w", purpose, err)
	}

	return nil
}

func (r *Repository) DeleteSystemConfig(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM system_agents WHERE id = $1`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("delete system agent config %q: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) ListSkills(ctx context.Context) ([]AgentSkill, error) {
	const query = `
SELECT
    id,
    name,
    slug,
    description,
    enabled,
    skill_markdown,
    created_at,
    updated_at
FROM agent_skills
ORDER BY enabled DESC, name ASC, updated_at DESC`

	rows, err := r.db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("list agent skills: %w", err)
	}
	defer rows.Close()

	items := make([]AgentSkill, 0)
	for rows.Next() {
		item, err := scanAgentSkill(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate agent skills: %w", err)
	}

	if err := r.attachSkillFiles(ctx, items); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *Repository) ListEnabledSkillsByAgentID(ctx context.Context, agentID string) ([]AgentSkill, error) {
	const query = `
SELECT
    s.id,
    s.name,
    s.slug,
    s.description,
    s.enabled,
    s.skill_markdown,
    s.created_at,
    s.updated_at
FROM system_agent_skill_bindings b
JOIN agent_skills s ON s.id = b.skill_id
WHERE b.agent_id = $1
  AND s.enabled = TRUE
ORDER BY b.sort_order ASC, s.name ASC`

	rows, err := r.db.QueryContext(ctx, query, strings.TrimSpace(agentID))
	if err != nil {
		return nil, fmt.Errorf("list enabled skills for agent %q: %w", agentID, err)
	}
	defer rows.Close()

	items := make([]AgentSkill, 0)
	for rows.Next() {
		item, err := scanAgentSkill(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate enabled skills for agent %q: %w", agentID, err)
	}

	if err := r.attachSkillFiles(ctx, items); err != nil {
		return nil, err
	}

	return items, nil
}

func (r *Repository) GetSkillByID(ctx context.Context, id string) (AgentSkill, error) {
	const query = `
SELECT
    id,
    name,
    slug,
    description,
    enabled,
    skill_markdown,
    created_at,
    updated_at
FROM agent_skills
WHERE id = $1`

	item, err := scanAgentSkill(r.db.QueryRowContext(ctx, query, strings.TrimSpace(id)))
	if err != nil {
		return AgentSkill{}, err
	}
	items := []AgentSkill{item}
	if err := r.attachSkillFiles(ctx, items); err != nil {
		return AgentSkill{}, err
	}
	return items[0], nil
}

func (r *Repository) UpsertSkill(ctx context.Context, skill AgentSkill) error {
	const query = `
INSERT INTO agent_skills (
    id,
    name,
    slug,
    description,
    enabled,
    skill_markdown
) VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE
SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    description = EXCLUDED.description,
    enabled = EXCLUDED.enabled,
    skill_markdown = EXCLUDED.skill_markdown,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		skill.ID,
		skill.Name,
		skill.Slug,
		skill.Description,
		skill.Enabled,
		skill.SkillMarkdown,
	); err != nil {
		return fmt.Errorf("upsert skill %q: %w", skill.ID, err)
	}

	return r.upsertSkillMarkdownFile(ctx, skill.ID, skill.SkillMarkdown)
}

func (r *Repository) DeleteSkill(ctx context.Context, id string) error {
	result, err := r.db.ExecContext(ctx, `DELETE FROM agent_skills WHERE id = $1`, strings.TrimSpace(id))
	if err != nil {
		return fmt.Errorf("delete skill %q: %w", id, err)
	}

	return ensureAffected(result, id)
}

func (r *Repository) UpsertSkillFile(ctx context.Context, file SkillFile) error {
	const query = `
INSERT INTO agent_skill_files (
    id,
    skill_id,
    path,
    file_kind,
    content_type,
    content_text,
    byte_size,
    sort_order
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (id) DO UPDATE
SET
    path = EXCLUDED.path,
    file_kind = EXCLUDED.file_kind,
    content_type = EXCLUDED.content_type,
    content_text = EXCLUDED.content_text,
    byte_size = EXCLUDED.byte_size,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW()`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		file.ID,
		file.SkillID,
		file.Path,
		file.FileKind,
		file.ContentType,
		file.ContentText,
		file.ByteSize,
		file.SortOrder,
	); err != nil {
		return fmt.Errorf("upsert skill file %q: %w", file.ID, err)
	}

	return nil
}

func (r *Repository) DeleteSkillFile(ctx context.Context, skillID string, fileID string) error {
	result, err := r.db.ExecContext(
		ctx,
		`DELETE FROM agent_skill_files WHERE skill_id = $1 AND id = $2 AND file_kind <> 'skill'`,
		strings.TrimSpace(skillID),
		strings.TrimSpace(fileID),
	)
	if err != nil {
		return fmt.Errorf("delete skill file %q: %w", fileID, err)
	}

	return ensureAffected(result, fileID)
}

func (r *Repository) upsertSkillMarkdownFile(ctx context.Context, skillID string, markdown string) error {
	trimmedSkillID := strings.TrimSpace(skillID)
	byteSize := int64(len([]byte(markdown)))

	result, err := r.db.ExecContext(
		ctx,
		`UPDATE agent_skill_files
         SET
             content_text = $2,
             byte_size = $3,
             updated_at = NOW()
         WHERE skill_id = $1
           AND LOWER(path) = LOWER('SKILL.md')
           AND file_kind = 'skill'`,
		trimmedSkillID,
		markdown,
		byteSize,
	)
	if err != nil {
		return fmt.Errorf("upsert skill markdown file for %q: %w", skillID, err)
	}
	if affected, err := result.RowsAffected(); err == nil && affected > 0 {
		return nil
	}

	const query = `
INSERT INTO agent_skill_files (
    id,
    skill_id,
    path,
    file_kind,
    content_type,
    content_text,
    byte_size,
    sort_order
) VALUES ($1, $2, 'SKILL.md', 'skill', 'text/markdown; charset=utf-8', $3, $4, -100)`

	if _, err := r.db.ExecContext(ctx, query, trimmedSkillID, trimmedSkillID, markdown, byteSize); err != nil {
		return fmt.Errorf("insert skill markdown file for %q: %w", skillID, err)
	}

	return nil
}

func (r *Repository) GetStatusCardByChatID(ctx context.Context, chatID string) (StatusCardView, error) {
	const baseQuery = `
SELECT
    csc.agent_id,
    csc.agent_name,
    csc.current_stage,
    csc.customer_types,
    csc.current_risk,
    csc.summary,
    csc.evidence,
    csc.next_action,
    csc.confidence,
    csc.message_count,
    csc.history_limit,
    csc.analyzed_at
FROM chat_status_cards csc
WHERE csc.chat_id = $1%s`

	scopeClause, scopeArgs := agentAccountScope(ctx, "csc.account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{strings.TrimSpace(chatID)}, scopeArgs...)

	return scanStatusCardView(r.db.QueryRowContext(ctx, query, args...))
}

func (r *Repository) UpsertStatusCard(ctx context.Context, chatID string, card StatusCardView) error {
	customerTypes, err := mustMarshalJSON(card.CustomerTypes)
	if err != nil {
		return err
	}
	evidence, err := mustMarshalJSON(card.Evidence)
	if err != nil {
		return err
	}

	const query = `
INSERT INTO chat_status_cards (
    chat_id,
    account_id,
    agent_id,
    agent_name,
    current_stage,
    customer_types,
    current_risk,
    summary,
    evidence,
    next_action,
    confidence,
    message_count,
    history_limit,
    analyzed_at
)
SELECT
    c.id,
    c.account_id,
    $2,
    $3,
    $4,
    $5,
    $6,
    $7,
    $8,
    $9,
    $10,
    $11,
    $12,
    $13
FROM chats c
WHERE c.id = $1
ON CONFLICT (chat_id) DO UPDATE
SET
    account_id = EXCLUDED.account_id,
    agent_id = EXCLUDED.agent_id,
    agent_name = EXCLUDED.agent_name,
    current_stage = EXCLUDED.current_stage,
    customer_types = EXCLUDED.customer_types,
    current_risk = EXCLUDED.current_risk,
    summary = EXCLUDED.summary,
    evidence = EXCLUDED.evidence,
    next_action = EXCLUDED.next_action,
    confidence = EXCLUDED.confidence,
    message_count = EXCLUDED.message_count,
    history_limit = EXCLUDED.history_limit,
    analyzed_at = EXCLUDED.analyzed_at,
    updated_at = NOW()`

	result, err := r.db.ExecContext(
		ctx,
		query,
		strings.TrimSpace(chatID),
		nullableTrimmedString(card.AgentID),
		card.AgentName,
		card.CurrentStage,
		customerTypes,
		card.CurrentRisk,
		card.Summary,
		evidence,
		card.NextAction,
		card.Confidence,
		card.MessageCount,
		card.HistoryLimit,
		card.AnalyzedAt,
	)
	if err != nil {
		return fmt.Errorf("upsert status card for chat %q: %w", chatID, err)
	}

	return ensureAffected(result, chatID)
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
		nullableTrimmedString(run.RuleID),
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
	const baseQuery = `
SELECT
    ar.id,
    ar.rule_id,
    COALESCE(rules.name, ar.input_context->>'rule_name', 'System Agent'),
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
LEFT JOIN agent_rules rules ON rules.id = ar.rule_id
LEFT JOIN chats ON chats.id = ar.chat_id
LEFT JOIN messages trigger_message ON trigger_message.id = ar.trigger_message_id
WHERE ar.id = $1%s`

	scopeClause, scopeArgs := agentAccountScope(ctx, "ar.account_id", 2)
	query := fmt.Sprintf(baseQuery, scopeClause)
	args := append([]any{id}, scopeArgs...)

	var (
		item           RunView
		ruleID         sql.NullString
		chatTitle      sql.NullString
		waChatJID      sql.NullString
		triggerPreview sql.NullString
		outputDraft    sql.NullString
		blockReason    sql.NullString
		completedAt    sql.NullTime
	)

	if err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&item.ID,
		&ruleID,
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

	item.RuleID = ruleID.String
	item.ChatTitle = nullableString(chatTitle)
	item.WAChatJID = nullableString(waChatJID)
	item.TriggerPreview = nullableString(triggerPreview)
	item.OutputDraft = nullableString(outputDraft)
	item.BlockReason = nullableString(blockReason)
	item.CompletedAt = nullableTime(completedAt)

	return item, nil
}

func (r *Repository) ListRuns(ctx context.Context, filters RunListFilters) ([]RunView, int, error) {
	whereClause, args := buildRunWhere(ctx, filters)

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
    COALESCE(rules.name, ar.input_context->>'rule_name', 'System Agent'),
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
LEFT JOIN agent_rules rules ON rules.id = ar.rule_id
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
			ruleID         sql.NullString
			chatTitle      sql.NullString
			waChatJID      sql.NullString
			triggerPreview sql.NullString
			outputDraft    sql.NullString
			blockReason    sql.NullString
			completedAt    sql.NullTime
		)

		if err := rows.Scan(
			&item.ID,
			&ruleID,
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

		item.RuleID = ruleID.String
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

func (r *Repository) CreateUsageLog(ctx context.Context, item AssistantUsageLog) error {
	triggerMessages, err := mustMarshalJSON(item.TriggerMessages)
	if err != nil {
		return err
	}

	const query = `
INSERT INTO assistant_usage_logs (
    id,
    user_id,
    ws_account_id,
    ws_account_name,
    chat_id,
    customer_id,
    customer_nickname,
    latest_message_id,
    latest_message_type,
    latest_message_text,
    latest_message_media_ref,
    latest_message_received_at,
    trigger_messages,
    agent_id,
    agent_name,
    adopted_option_index,
    adopted_option_content,
    translation_source_content,
    final_draft_content,
    translated_content,
    target_language,
    action_type,
    log_date,
    created_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24
)`

	if _, err := r.db.ExecContext(
		ctx,
		query,
		item.ID,
		item.UserID,
		item.WSAccountID,
		item.WSAccountName,
		item.ChatID,
		item.CustomerID,
		item.CustomerNickname,
		item.LatestMessageID,
		item.LatestMessageType,
		item.LatestMessageText,
		item.LatestMessageMediaRef,
		item.LatestMessageReceivedAt,
		triggerMessages,
		item.AgentID,
		item.AgentName,
		item.AdoptedOptionIndex,
		item.AdoptedOptionContent,
		item.TranslationSourceContent,
		item.FinalDraftContent,
		item.TranslatedContent,
		item.TargetLanguage,
		item.ActionType,
		item.LogDate,
		item.CreatedAt,
	); err != nil {
		return fmt.Errorf("create assistant usage log %q: %w", item.ID, err)
	}

	return nil
}

func (r *Repository) ListUsageLogs(ctx context.Context, filters AssistantUsageLogFilters) ([]AssistantUsageLogView, int, error) {
	whereClause, args := buildUsageLogWhere(ctx, filters)

	countQuery := fmt.Sprintf(`SELECT COUNT(*) FROM assistant_usage_logs aul WHERE %s`, whereClause)
	var total int
	if err := r.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count assistant usage logs: %w", err)
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, filters.Limit, filters.Offset)
	limitIndex := len(args) + 1
	offsetIndex := len(args) + 2

	query := fmt.Sprintf(`
SELECT
    aul.id,
    aul.user_id,
    aul.ws_account_id,
    aul.ws_account_name,
    aul.chat_id,
    aul.customer_id,
    aul.customer_nickname,
    aul.latest_message_id,
    aul.latest_message_type,
    aul.latest_message_text,
    aul.latest_message_media_ref,
    aul.latest_message_received_at,
    COALESCE(aul.trigger_messages, '[]'::jsonb),
    aul.agent_id,
    aul.agent_name,
    aul.adopted_option_index,
    aul.adopted_option_content,
    aul.translation_source_content,
    aul.final_draft_content,
    aul.translated_content,
    aul.target_language,
    aul.action_type,
    aul.log_date,
    aul.created_at
FROM assistant_usage_logs aul
WHERE %s
ORDER BY aul.created_at DESC, aul.id DESC
LIMIT $%d OFFSET $%d`, whereClause, limitIndex, offsetIndex)

	rows, err := r.db.QueryContext(ctx, query, listArgs...)
	if err != nil {
		return nil, 0, fmt.Errorf("list assistant usage logs: %w", err)
	}
	defer rows.Close()

	items := make([]AssistantUsageLogView, 0, filters.Limit)
	for rows.Next() {
		var (
			item                    AssistantUsageLogView
			latestMessageReceivedAt sql.NullTime
			adoptedOptionIndex      sql.NullInt64
			triggerMessages         []byte
			logDate                 time.Time
		)

		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.WSAccountID,
			&item.WSAccountName,
			&item.ChatID,
			&item.CustomerID,
			&item.CustomerNickname,
			&item.LatestMessageID,
			&item.LatestMessageType,
			&item.LatestMessageText,
			&item.LatestMessageMediaRef,
			&latestMessageReceivedAt,
			&triggerMessages,
			&item.AgentID,
			&item.AgentName,
			&adoptedOptionIndex,
			&item.AdoptedOptionContent,
			&item.TranslationSourceContent,
			&item.FinalDraftContent,
			&item.TranslatedContent,
			&item.TargetLanguage,
			&item.ActionType,
			&logDate,
			&item.CreatedAt,
		); err != nil {
			return nil, 0, fmt.Errorf("scan assistant usage log row: %w", err)
		}

		item.LatestMessageReceivedAt = nullableTime(latestMessageReceivedAt)
		item.AdoptedOptionIndex = nullableInt(adoptedOptionIndex)
		if err := json.Unmarshal(triggerMessages, &item.TriggerMessages); err != nil {
			return nil, 0, fmt.Errorf("decode assistant usage trigger messages: %w", err)
		}
		if item.TriggerMessages == nil {
			item.TriggerMessages = []AssistantUsageTriggerMessage{}
		}
		item.LogDate = logDate.Format("2006-01-02")
		items = append(items, item)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate assistant usage logs: %w", err)
	}

	return items, total, nil
}

func (r *Repository) ListUsageLogFilterOptions(ctx context.Context) (AssistantUsageLogFilterOptions, error) {
	whereClause, args := buildUsageLogWhere(ctx, AssistantUsageLogFilters{})

	query := fmt.Sprintf(`
SELECT
    COALESCE(NULLIF(aul.ws_account_id, ''), '') AS id,
    COALESCE(NULLIF(MAX(aul.ws_account_name), ''), COALESCE(NULLIF(aul.ws_account_id, ''), '未知账号')) AS name
FROM assistant_usage_logs aul
WHERE %s
  AND COALESCE(NULLIF(aul.ws_account_id, ''), '') <> ''
GROUP BY COALESCE(NULLIF(aul.ws_account_id, ''), '')
ORDER BY name ASC`, whereClause)

	accountRows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return AssistantUsageLogFilterOptions{}, fmt.Errorf("list assistant usage account filters: %w", err)
	}
	defer accountRows.Close()

	options := AssistantUsageLogFilterOptions{
		Accounts: make([]AssistantUsageLogFilterOption, 0),
		Agents:   make([]AssistantUsageLogFilterOption, 0),
	}
	for accountRows.Next() {
		var option AssistantUsageLogFilterOption
		if err := accountRows.Scan(&option.ID, &option.Name); err != nil {
			return AssistantUsageLogFilterOptions{}, fmt.Errorf("scan assistant usage account filter: %w", err)
		}
		options.Accounts = append(options.Accounts, option)
	}
	if err := accountRows.Err(); err != nil {
		return AssistantUsageLogFilterOptions{}, fmt.Errorf("iterate assistant usage account filters: %w", err)
	}

	query = fmt.Sprintf(`
SELECT
    COALESCE(NULLIF(aul.agent_id, ''), '') AS id,
    COALESCE(NULLIF(MAX(aul.agent_name), ''), COALESCE(NULLIF(aul.agent_id, ''), '未知智能体')) AS name
FROM assistant_usage_logs aul
WHERE %s
  AND COALESCE(NULLIF(aul.agent_id, ''), '') <> ''
GROUP BY COALESCE(NULLIF(aul.agent_id, ''), '')
ORDER BY name ASC`, whereClause)

	agentRows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return AssistantUsageLogFilterOptions{}, fmt.Errorf("list assistant usage agent filters: %w", err)
	}
	defer agentRows.Close()

	for agentRows.Next() {
		var option AssistantUsageLogFilterOption
		if err := agentRows.Scan(&option.ID, &option.Name); err != nil {
			return AssistantUsageLogFilterOptions{}, fmt.Errorf("scan assistant usage agent filter: %w", err)
		}
		options.Agents = append(options.Agents, option)
	}
	if err := agentRows.Err(); err != nil {
		return AssistantUsageLogFilterOptions{}, fmt.Errorf("iterate assistant usage agent filters: %w", err)
	}

	return options, nil
}

func buildRuleWhere(ctx context.Context, filters RuleListFilters) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 2)

	if filters.AccountID != "" {
		args = append(args, filters.AccountID)
		conditions = append(conditions, fmt.Sprintf(`(
    ar.account_id = $%d
    OR EXISTS (
        SELECT 1
        FROM agent_rule_accounts ara_filter
        WHERE ara_filter.rule_id = ar.id
          AND ara_filter.account_id = $%d
    )
)`, len(args), len(args)))
	}
	if filters.Enabled != nil {
		args = append(args, *filters.Enabled)
		conditions = append(conditions, fmt.Sprintf("ar.enabled = $%d", len(args)))
	}
	if scopeCondition, scopeArgs := agentRuleScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}

	return strings.Join(conditions, " AND "), args
}

func buildRunWhere(ctx context.Context, filters RunListFilters) (string, []any) {
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
	if scopeCondition, scopeArgs := agentRunScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}

	return strings.Join(conditions, " AND "), args
}

func buildUsageLogWhere(ctx context.Context, filters AssistantUsageLogFilters) (string, []any) {
	conditions := []string{"1 = 1"}
	args := make([]any, 0, 6)

	if filters.LogDate != "" {
		args = append(args, filters.LogDate)
		conditions = append(conditions, fmt.Sprintf("aul.log_date = $%d::date", len(args)))
	}
	if filters.UserID != "" {
		args = append(args, filters.UserID)
		conditions = append(conditions, fmt.Sprintf("aul.user_id = $%d", len(args)))
	}
	if filters.AccountID != "" {
		args = append(args, filters.AccountID)
		conditions = append(conditions, fmt.Sprintf("aul.ws_account_id = $%d", len(args)))
	}
	if filters.ChatID != "" {
		args = append(args, filters.ChatID)
		conditions = append(conditions, fmt.Sprintf("aul.chat_id = $%d", len(args)))
	}
	if filters.AgentID != "" {
		args = append(args, filters.AgentID)
		conditions = append(conditions, fmt.Sprintf("aul.agent_id = $%d", len(args)))
	}
	if filters.Action != "" {
		args = append(args, filters.Action)
		conditions = append(conditions, fmt.Sprintf("aul.action_type = $%d", len(args)))
	}
	if scopeCondition, scopeArgs := usageLogScopeCondition(ctx, len(args)+1); scopeCondition != "" {
		conditions = append(conditions, scopeCondition)
		args = append(args, scopeArgs...)
	}

	return strings.Join(conditions, " AND "), args
}

func agentAccountScope(ctx context.Context, accountColumn string, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(` AND EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = %s
      AND account_scope.user_id = $%d
)`, strings.TrimSpace(accountColumn), startIndex), []any{currentUser.ID}
}

func agentRuleScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(`EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = ar.account_id
      AND account_scope.user_id = $%d
)`, startIndex), []any{currentUser.ID}
}

func agentRunScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf(`EXISTS (
    SELECT 1
    FROM accounts account_scope
    WHERE account_scope.id = ar.account_id
      AND account_scope.user_id = $%d
)`, startIndex), []any{currentUser.ID}
}

func usageLogScopeCondition(ctx context.Context, startIndex int) (string, []any) {
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return "", nil
	}

	return fmt.Sprintf("aul.user_id = $%d", startIndex), []any{currentUser.ID}
}

func decodeRuleFilters(
	rule *AgentRule,
	scopeFilter []byte,
	triggerFilter []byte,
	blacklistFilter []byte,
	providerConfig []byte,
	knowledgeBinding []byte,
	accountIDs []byte,
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
	if len(accountIDs) > 0 {
		if err := json.Unmarshal(accountIDs, &rule.AccountIDs); err != nil {
			return fmt.Errorf("decode rule %q account ids: %w", rule.ID, err)
		}
	}
	if len(rule.AccountIDs) == 0 {
		rule.AccountIDs = []string{rule.AccountID}
	}
	if rule.Purpose == "" {
		rule.Purpose = AgentPurposeReply
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

func (r *Repository) attachSkillIDs(ctx context.Context, items []SystemAgentConfig) error {
	if len(items) == 0 {
		return nil
	}

	ids := make([]string, 0, len(items))
	byID := make(map[string]int, len(items))
	for index := range items {
		items[index].SkillIDs = []string{}
		trimmedID := strings.TrimSpace(items[index].ID)
		if trimmedID == "" {
			continue
		}
		ids = append(ids, trimmedID)
		byID[trimmedID] = index
	}
	if len(ids) == 0 {
		return nil
	}

	rows, err := r.db.QueryContext(
		ctx,
		`SELECT agent_id::text, skill_id::text
         FROM system_agent_skill_bindings
         WHERE agent_id = ANY($1::uuid[])
         ORDER BY agent_id::text, sort_order ASC, skill_id::text`,
		postgresTextArray(ids),
	)
	if err != nil {
		return fmt.Errorf("list system agent skill bindings: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var agentID string
		var skillID string
		if err := rows.Scan(&agentID, &skillID); err != nil {
			return fmt.Errorf("scan system agent skill binding: %w", err)
		}
		if index, ok := byID[agentID]; ok {
			items[index].SkillIDs = append(items[index].SkillIDs, skillID)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate system agent skill bindings: %w", err)
	}

	return nil
}

func (r *Repository) attachSkillFiles(ctx context.Context, items []AgentSkill) error {
	if len(items) == 0 {
		return nil
	}

	ids := make([]string, 0, len(items))
	byID := make(map[string]int, len(items))
	for index := range items {
		items[index].Files = []SkillFile{}
		trimmedID := strings.TrimSpace(items[index].ID)
		if trimmedID == "" {
			continue
		}
		ids = append(ids, trimmedID)
		byID[trimmedID] = index
	}
	if len(ids) == 0 {
		return nil
	}

	rows, err := r.db.QueryContext(
		ctx,
		`SELECT
             id,
             skill_id,
             path,
             file_kind,
             content_type,
             content_text,
             byte_size,
             sort_order,
             created_at,
             updated_at
         FROM agent_skill_files
         WHERE skill_id = ANY($1::uuid[])
         ORDER BY skill_id::text, sort_order ASC, path ASC`,
		postgresTextArray(ids),
	)
	if err != nil {
		return fmt.Errorf("list agent skill files: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		file, err := scanSkillFile(rows)
		if err != nil {
			return err
		}
		if index, ok := byID[file.SkillID]; ok {
			items[index].Files = append(items[index].Files, file)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate agent skill files: %w", err)
	}

	return nil
}

func (r *Repository) syncRuleAccounts(ctx context.Context, ruleID string, primaryAccountID string, accountIDs []string) error {
	if _, err := r.db.ExecContext(ctx, `DELETE FROM agent_rule_accounts WHERE rule_id = $1`, ruleID); err != nil {
		return fmt.Errorf("clear agent rule accounts for %q: %w", ruleID, err)
	}

	normalized := normalizeAccountIDs(primaryAccountID, accountIDs)
	for _, accountID := range normalized {
		if _, err := r.db.ExecContext(
			ctx,
			`INSERT INTO agent_rule_accounts (rule_id, account_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
			ruleID,
			accountID,
		); err != nil {
			return fmt.Errorf("bind agent rule %q to account %q: %w", ruleID, accountID, err)
		}
	}

	return nil
}

func postgresTextArray(values []string) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		parts = append(parts, `"`+strings.ReplaceAll(trimmed, `"`, `\"`)+`"`)
	}
	return "{" + strings.Join(parts, ",") + "}"
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

func nullableInt(value sql.NullInt64) *int {
	if !value.Valid {
		return nil
	}

	result := int(value.Int64)
	return &result
}

func nullableTrimmedString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}

	return &trimmed
}

func nullableTime(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time
	return &result
}

func boolPointer(value bool) *bool {
	return &value
}

func scanSystemConfig(row rowScanner) (SystemAgentConfig, error) {
	var (
		item           SystemAgentConfig
		providerConfig []byte
	)

	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Purpose,
		&item.Enabled,
		&providerConfig,
		&item.PromptTemplate,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return SystemAgentConfig{}, err
	}
	if err := json.Unmarshal(providerConfig, &item.ProviderConfig); err != nil {
		return SystemAgentConfig{}, fmt.Errorf("decode system agent config %q: %w", item.ID, err)
	}
	if item.ProviderConfig == nil {
		item.ProviderConfig = map[string]any{}
	}

	return item, nil
}

func scanAgentSkill(row rowScanner) (AgentSkill, error) {
	var item AgentSkill
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Slug,
		&item.Description,
		&item.Enabled,
		&item.SkillMarkdown,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return AgentSkill{}, err
	}
	if item.Files == nil {
		item.Files = []SkillFile{}
	}
	return item, nil
}

func scanSkillFile(row rowScanner) (SkillFile, error) {
	var item SkillFile
	if err := row.Scan(
		&item.ID,
		&item.SkillID,
		&item.Path,
		&item.FileKind,
		&item.ContentType,
		&item.ContentText,
		&item.ByteSize,
		&item.SortOrder,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return SkillFile{}, fmt.Errorf("scan skill file row: %w", err)
	}
	return item, nil
}

func scanStatusCardView(row rowScanner) (StatusCardView, error) {
	var (
		item          StatusCardView
		agentID       sql.NullString
		customerTypes []byte
		evidence      []byte
	)

	if err := row.Scan(
		&agentID,
		&item.AgentName,
		&item.CurrentStage,
		&customerTypes,
		&item.CurrentRisk,
		&item.Summary,
		&evidence,
		&item.NextAction,
		&item.Confidence,
		&item.MessageCount,
		&item.HistoryLimit,
		&item.AnalyzedAt,
	); err != nil {
		return StatusCardView{}, err
	}
	item.AgentID = agentID.String
	if err := json.Unmarshal(customerTypes, &item.CustomerTypes); err != nil {
		return StatusCardView{}, fmt.Errorf("decode status card customer types: %w", err)
	}
	if item.CustomerTypes == nil {
		item.CustomerTypes = []string{}
	}
	if err := json.Unmarshal(evidence, &item.Evidence); err != nil {
		return StatusCardView{}, fmt.Errorf("decode status card evidence: %w", err)
	}
	if item.Evidence == nil {
		item.Evidence = []string{}
	}

	return item, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}
