package agents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/accounts"
	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/ingest"
	"whatsapp-agent-platform/internal/support/ids"
)

var (
	ErrRuleNotFound     = errors.New("agent rule not found")
	ErrSettingsNotFound = errors.New("agent settings not found")
	ErrAccountNotFound  = errors.New("account not found")
)

type AccountLookup interface {
	GetByID(ctx context.Context, id string) (accounts.Account, error)
}

type Service struct {
	repository    *Repository
	accountLookup AccountLookup
	now           func() time.Time
}

func NewService(repository *Repository, accountLookup AccountLookup) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("agent service requires a repository")
	}

	return &Service{
		repository:    repository,
		accountLookup: accountLookup,
		now:           func() time.Time { return time.Now().UTC() },
	}, nil
}

func (s *Service) ListRules(ctx context.Context, filters RuleListFilters) ([]RuleView, error) {
	items, err := s.repository.ListRules(ctx, RuleListFilters{
		AccountID: strings.TrimSpace(filters.AccountID),
		Enabled:   filters.Enabled,
	})
	if err != nil {
		return nil, err
	}

	views := make([]RuleView, 0, len(items))
	for _, item := range items {
		views = append(views, mapRuleToViewForContext(ctx, item))
	}

	return views, nil
}

func (s *Service) GetRule(ctx context.Context, ruleID string) (RuleView, error) {
	rule, err := s.repository.GetRuleByID(ctx, strings.TrimSpace(ruleID))
	if err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	return mapRuleToViewForContext(ctx, rule), nil
}

func (s *Service) UpsertRule(ctx context.Context, input UpsertRuleInput) (RuleView, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return RuleView{}, err
	}

	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return RuleView{}, fmt.Errorf("account_id is required")
	}
	if err := s.ensureAccountExists(ctx, accountID); err != nil {
		return RuleView{}, err
	}
	accountIDs := normalizeAccountIDs(accountID, input.AccountIDs)
	for _, boundAccountID := range accountIDs {
		if err := s.ensureAccountExists(ctx, boundAccountID); err != nil {
			return RuleView{}, err
		}
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		return RuleView{}, fmt.Errorf("name is required")
	}
	purpose := normalizeAgentPurpose(input.Purpose)
	if purpose == "" {
		return RuleView{}, fmt.Errorf("unsupported purpose %q", input.Purpose)
	}

	replyMode := normalizeReplyMode(input.ReplyMode)
	if replyMode == "" {
		return RuleView{}, fmt.Errorf("unsupported reply_mode %q", input.ReplyMode)
	}

	scopeFilter, err := normalizeScopeFilter(input.ScopeFilter)
	if err != nil {
		return RuleView{}, err
	}
	triggerFilter, err := normalizeTriggerFilter(input.TriggerFilter)
	if err != nil {
		return RuleView{}, err
	}
	blacklistFilter := normalizeBlacklistFilter(input.BlacklistFilter)
	knowledgeBinding := normalizeKnowledgeBinding(input.KnowledgeBinding)
	providerConfig, err := normalizeProviderConfig(input.ProviderConfig)
	if err != nil {
		return RuleView{}, err
	}
	if purpose == AgentPurposeTranslation && normalizeProviderType(anyString(providerConfig["type"])) != "openai_compatible" {
		return RuleView{}, fmt.Errorf("translation agent requires provider_config.type openai_compatible")
	}

	promptTemplate := strings.TrimSpace(input.PromptTemplate)

	cooldownSeconds := input.CooldownSeconds
	if cooldownSeconds < 0 {
		return RuleView{}, fmt.Errorf("cooldown_seconds must be 0 or greater")
	}
	if cooldownSeconds == 0 {
		cooldownSeconds = 300
	}

	maxAutoReplies := input.MaxAutoRepliesPerThread
	if maxAutoReplies < 0 {
		return RuleView{}, fmt.Errorf("max_auto_replies_per_thread must be 0 or greater")
	}
	if replyMode == ReplyModeAutoSend && maxAutoReplies == 0 {
		maxAutoReplies = 1
	}

	ruleID := strings.TrimSpace(input.ID)
	enabled := input.Enabled
	if replyMode == ReplyModeAutoSend && ruleID == "" {
		enabled = false
	}

	if ruleID == "" {
		rule := AgentRule{
			ID:                      ids.NewUUID(),
			AccountID:               accountID,
			AccountIDs:              accountIDs,
			Purpose:                 purpose,
			Name:                    name,
			Enabled:                 enabled,
			ScopeFilter:             scopeFilter,
			TriggerFilter:           triggerFilter,
			ReplyMode:               replyMode,
			CooldownSeconds:         cooldownSeconds,
			MaxAutoRepliesPerThread: maxAutoReplies,
			BlacklistFilter:         blacklistFilter,
			PromptTemplate:          promptTemplate,
			ProviderConfig:          providerConfig,
			KnowledgeBinding:        knowledgeBinding,
			CreatedAt:               s.now(),
			UpdatedAt:               s.now(),
		}

		if err := s.repository.CreateRule(ctx, rule); err != nil {
			return RuleView{}, err
		}

		stored, err := s.repository.GetRuleByID(ctx, rule.ID)
		if err != nil {
			return RuleView{}, err
		}

		return mapRuleToView(stored), nil
	}

	existing, err := s.repository.GetRuleByID(ctx, ruleID)
	if err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	if replyMode == ReplyModeAutoSend && existing.ReplyMode != ReplyModeAutoSend {
		enabled = false
	}

	rule := AgentRule{
		ID:                      existing.ID,
		AccountID:               accountID,
		AccountIDs:              accountIDs,
		Purpose:                 purpose,
		Name:                    name,
		Enabled:                 enabled,
		ScopeFilter:             scopeFilter,
		TriggerFilter:           triggerFilter,
		ReplyMode:               replyMode,
		CooldownSeconds:         cooldownSeconds,
		MaxAutoRepliesPerThread: maxAutoReplies,
		BlacklistFilter:         blacklistFilter,
		PromptTemplate:          promptTemplate,
		ProviderConfig:          providerConfig,
		KnowledgeBinding:        knowledgeBinding,
		CreatedAt:               existing.CreatedAt,
		UpdatedAt:               s.now(),
	}

	if err := s.repository.UpdateRule(ctx, rule); err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	stored, err := s.repository.GetRuleByID(ctx, rule.ID)
	if err != nil {
		return RuleView{}, err
	}

	return mapRuleToView(stored), nil
}

func (s *Service) SetRuleEnabled(ctx context.Context, ruleID string, enabled bool) (RuleView, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return RuleView{}, err
	}

	rule, err := s.repository.GetRuleByID(ctx, strings.TrimSpace(ruleID))
	if err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	if enabled && rule.ReplyMode == ReplyModeAutoSend {
		if rule.CooldownSeconds <= 0 {
			return RuleView{}, fmt.Errorf("auto-send rule requires a cooldown_seconds value")
		}
		if rule.MaxAutoRepliesPerThread <= 0 {
			return RuleView{}, fmt.Errorf("auto-send rule requires max_auto_replies_per_thread")
		}
	}

	if err := s.repository.SetRuleEnabled(ctx, rule.ID, enabled); err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	stored, err := s.repository.GetRuleByID(ctx, rule.ID)
	if err != nil {
		return RuleView{}, err
	}

	return mapRuleToView(stored), nil
}

func (s *Service) DeleteRule(ctx context.Context, ruleID string) (RuleView, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return RuleView{}, err
	}

	rule, err := s.repository.GetRuleByID(ctx, strings.TrimSpace(ruleID))
	if err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	if err := s.repository.DeleteRule(ctx, rule.ID); err != nil {
		return RuleView{}, mapRuleError(ruleID, err)
	}

	return mapRuleToView(rule), nil
}

func (s *Service) GetSettings(ctx context.Context, accountID string) (SettingsView, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return SettingsView{}, err
	}

	trimmedAccountID := strings.TrimSpace(accountID)
	if trimmedAccountID == "" {
		return SettingsView{}, fmt.Errorf("account_id is required")
	}

	settings, err := s.repository.GetSettings(ctx, trimmedAccountID)
	if err != nil {
		return SettingsView{}, mapSettingsError(trimmedAccountID, err)
	}

	return mapSettingsToView(settings), nil
}

func (s *Service) UpsertSettings(ctx context.Context, input UpsertSettingsInput) (SettingsView, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return SettingsView{}, err
	}

	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return SettingsView{}, fmt.Errorf("account_id is required")
	}
	if err := s.ensureAccountExists(ctx, accountID); err != nil {
		return SettingsView{}, err
	}

	provider := strings.ToLower(strings.TrimSpace(input.Provider))
	if provider == "" {
		return SettingsView{}, fmt.Errorf("provider is required")
	}

	model := strings.TrimSpace(input.Model)
	if model == "" {
		return SettingsView{}, fmt.Errorf("model is required")
	}

	baseURL := strings.TrimSpace(input.BaseURL)
	if baseURL == "" {
		return SettingsView{}, fmt.Errorf("base_url is required")
	}

	apiKey := strings.TrimSpace(input.APIKey)
	if apiKey == "" {
		return SettingsView{}, fmt.Errorf("api_key is required")
	}

	promptTemplate := strings.TrimSpace(input.PromptTemplate)
	if promptTemplate == "" {
		return SettingsView{}, fmt.Errorf("prompt_template is required")
	}

	settings := AgentSettings{
		AccountID:      accountID,
		Provider:       provider,
		Model:          model,
		BaseURL:        baseURL,
		APIKey:         apiKey,
		PromptTemplate: promptTemplate,
	}

	if err := s.repository.UpsertSettings(ctx, settings); err != nil {
		return SettingsView{}, err
	}

	stored, err := s.repository.GetSettings(ctx, accountID)
	if err != nil {
		return SettingsView{}, mapSettingsError(accountID, err)
	}

	return mapSettingsToView(stored), nil
}

func mapRuleToViewForContext(ctx context.Context, rule AgentRule) RuleView {
	view := mapRuleToView(rule)
	currentUser, ok := auth.CurrentUser(ctx)
	if !ok || currentUser.IsAdmin() {
		return view
	}

	view.ProviderConfig = publicProviderConfig(view.ProviderConfig)
	view.PromptTemplate = ""
	view.KnowledgeBinding = nil
	return view
}

func publicProviderConfig(config map[string]any) map[string]any {
	result := make(map[string]any)
	for _, key := range []string{"type", "model", "enable_thinking"} {
		if value, ok := config[key]; ok {
			result[key] = value
		}
	}

	return result
}

func (s *Service) ListSystemConfigs(ctx context.Context) ([]SystemAgentConfig, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return nil, err
	}

	items, err := s.repository.ListSystemConfigs(ctx)
	if err != nil {
		return nil, err
	}

	return items, nil
}

func (s *Service) ListAvailableSystemConfigs(ctx context.Context, purpose AgentPurpose) ([]SystemAgentConfig, error) {
	if _, err := auth.RequireUser(ctx); err != nil {
		return nil, err
	}

	normalizedPurpose := normalizeAgentPurpose(purpose)
	if purpose != "" && normalizedPurpose == "" {
		return nil, fmt.Errorf("unsupported purpose %q", purpose)
	}

	items, err := s.repository.ListEnabledSystemConfigs(ctx, normalizedPurpose)
	if err != nil {
		return nil, err
	}
	if normalizedPurpose == AgentPurposeTranslation && len(items) > 1 {
		items = items[:1]
	}

	for index := range items {
		items[index].ProviderConfig = publicProviderConfig(items[index].ProviderConfig)
		items[index].PromptTemplate = ""
	}

	return items, nil
}

func (s *Service) UpsertSystemConfig(ctx context.Context, input UpsertSystemConfigInput) (SystemAgentConfig, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return SystemAgentConfig{}, err
	}

	purpose := normalizeAgentPurpose(input.Purpose)
	if purpose == "" {
		return SystemAgentConfig{}, fmt.Errorf("unsupported purpose %q", input.Purpose)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return SystemAgentConfig{}, fmt.Errorf("agent name is required")
	}

	providerConfig, err := normalizeProviderConfig(input.ProviderConfig)
	if err != nil {
		return SystemAgentConfig{}, err
	}
	if input.Enabled && normalizeProviderType(anyString(providerConfig["type"])) == "" {
		return SystemAgentConfig{}, fmt.Errorf("provider_config.type is required when config is enabled")
	}
	if purpose == AgentPurposeTranslation && input.Enabled && normalizeProviderType(anyString(providerConfig["type"])) != "openai_compatible" {
		return SystemAgentConfig{}, fmt.Errorf("translation config requires provider_config.type openai_compatible")
	}

	config := SystemAgentConfig{
		ID:             strings.TrimSpace(input.ID),
		Name:           name,
		Purpose:        purpose,
		Enabled:        input.Enabled,
		ProviderConfig: providerConfig,
		PromptTemplate: strings.TrimSpace(input.PromptTemplate),
	}
	if config.ID == "" {
		config.ID = ids.NewUUID()
	}

	if err := s.repository.UpsertSystemConfig(ctx, config); err != nil {
		return SystemAgentConfig{}, err
	}
	if purpose == AgentPurposeTranslation && config.Enabled {
		if err := s.repository.DisableOtherSystemConfigs(ctx, purpose, config.ID); err != nil {
			return SystemAgentConfig{}, err
		}
	}

	return s.repository.GetSystemConfigByID(ctx, config.ID, purpose)
}

func (s *Service) DeleteSystemConfig(ctx context.Context, id string) error {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return err
	}

	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return fmt.Errorf("agent id is required")
	}

	return s.repository.DeleteSystemConfig(ctx, trimmedID)
}

func (s *Service) ListRuns(ctx context.Context, filters RunListFilters) (RunListResult, error) {
	limit := filters.Limit
	if limit <= 0 {
		limit = 12
	}
	if limit > 100 {
		limit = 100
	}

	offset := filters.Offset
	if offset < 0 {
		offset = 0
	}

	status := normalizeRunStatus(filters.Status)
	if filters.Status != "" && status == "" {
		return RunListResult{}, fmt.Errorf("unsupported status %q", filters.Status)
	}

	items, total, err := s.repository.ListRuns(ctx, RunListFilters{
		AccountID: strings.TrimSpace(filters.AccountID),
		RuleID:    strings.TrimSpace(filters.RuleID),
		ChatID:    strings.TrimSpace(filters.ChatID),
		Status:    status,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		return RunListResult{}, err
	}

	return RunListResult{
		Runs:   items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

func (s *Service) ensureAccountExists(ctx context.Context, accountID string) error {
	if s.accountLookup == nil {
		return nil
	}

	if _, err := s.accountLookup.GetByID(ctx, accountID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("%w: %s", ErrAccountNotFound, accountID)
		}
		return err
	}

	return nil
}

func mapRuleError(ruleID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrRuleNotFound, ruleID)
	}

	return err
}

func mapSettingsError(accountID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrSettingsNotFound, accountID)
	}

	return err
}

func normalizeReplyMode(value ReplyMode) ReplyMode {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(ReplyModeManual):
		return ReplyModeManual
	case string(ReplyModeSuggest):
		return ReplyModeSuggest
	case string(ReplyModeAutoSend):
		return ReplyModeAutoSend
	default:
		return ""
	}
}

func normalizeAgentPurpose(value AgentPurpose) AgentPurpose {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case "", string(AgentPurposeReply):
		return AgentPurposeReply
	case string(AgentPurposeTranslation):
		return AgentPurposeTranslation
	default:
		return ""
	}
}

func normalizeAccountIDs(primary string, values []string) []string {
	result := make([]string, 0, len(values)+1)
	seen := make(map[string]struct{}, len(values)+1)

	add := func(value string) {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			return
		}
		if _, exists := seen[trimmed]; exists {
			return
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}

	add(primary)
	for _, value := range values {
		add(value)
	}

	return result
}

func normalizeRunStatus(value RunStatus) RunStatus {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case "":
		return ""
	case string(RunStatusQueued):
		return RunStatusQueued
	case string(RunStatusGenerating):
		return RunStatusGenerating
	case string(RunStatusBlocked):
		return RunStatusBlocked
	case string(RunStatusReadyForReview):
		return RunStatusReadyForReview
	case string(RunStatusSent):
		return RunStatusSent
	case string(RunStatusFailed):
		return RunStatusFailed
	default:
		return ""
	}
}

func normalizeMatchMode(value MatchMode) MatchMode {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case "", string(MatchModeAny):
		return MatchModeAny
	case string(MatchModeAll):
		return MatchModeAll
	default:
		return ""
	}
}

func normalizeScopeFilter(filter ScopeFilter) (ScopeFilter, error) {
	chatTypes := make([]string, 0, len(filter.ChatTypes))
	seenChatTypes := make(map[string]struct{}, len(filter.ChatTypes))
	for _, chatType := range filter.ChatTypes {
		normalized, err := normalizeChatType(chatType)
		if err != nil {
			return ScopeFilter{}, err
		}
		if _, exists := seenChatTypes[normalized]; exists {
			continue
		}
		seenChatTypes[normalized] = struct{}{}
		chatTypes = append(chatTypes, normalized)
	}

	return ScopeFilter{
		ChatIDs:   normalizeStringList(filter.ChatIDs),
		ChatTypes: chatTypes,
	}, nil
}

func normalizeTriggerFilter(filter TriggerFilter) (TriggerFilter, error) {
	matchMode := normalizeMatchMode(filter.MatchMode)
	if matchMode == "" {
		return TriggerFilter{}, fmt.Errorf("unsupported trigger_filter.match_mode %q", filter.MatchMode)
	}
	if filter.MinMessageChars < 0 {
		return TriggerFilter{}, fmt.Errorf("trigger_filter.min_message_chars must be 0 or greater")
	}

	return TriggerFilter{
		Keywords:        normalizeStringList(filter.Keywords),
		MatchMode:       matchMode,
		IgnoreFromMe:    filter.IgnoreFromMe,
		MinMessageChars: filter.MinMessageChars,
	}, nil
}

func normalizeBlacklistFilter(filter BlacklistFilter) BlacklistFilter {
	return BlacklistFilter{
		BlockedKeywords: normalizeStringList(filter.BlockedKeywords),
		SensitiveTopics: normalizeStringList(filter.SensitiveTopics),
	}
}

func normalizeKnowledgeBinding(binding *KnowledgeBinding) *KnowledgeBinding {
	if binding == nil {
		return nil
	}

	var summary *string
	if binding.Summary != nil {
		trimmed := strings.TrimSpace(*binding.Summary)
		if trimmed != "" {
			summary = &trimmed
		}
	}

	references := normalizeStringList(binding.References)
	if summary == nil && len(references) == 0 {
		return nil
	}

	return &KnowledgeBinding{
		Summary:    summary,
		References: references,
	}
}

func normalizeProviderConfig(config map[string]any) (map[string]any, error) {
	if len(config) == 0 {
		return map[string]any{}, nil
	}

	normalized := make(map[string]any, len(config))
	for key, value := range config {
		cleanKey := strings.TrimSpace(key)
		if cleanKey == "" || value == nil {
			continue
		}

		switch typed := value.(type) {
		case string:
			cleanValue := strings.TrimSpace(typed)
			if cleanValue != "" {
				normalized[cleanKey] = cleanValue
			}
		case bool, float64, float32, int, int64, int32, uint, uint64, uint32:
			normalized[cleanKey] = typed
		case []any:
			normalized[cleanKey] = typed
		case map[string]any:
			normalized[cleanKey] = typed
		default:
			normalized[cleanKey] = typed
		}
	}

	providerType := normalizeProviderType(anyString(normalized["type"]))
	if providerType == "" {
		if len(normalized) == 0 {
			return map[string]any{}, nil
		}
		return nil, fmt.Errorf("provider_config.type is required")
	}
	normalized["type"] = providerType

	return normalized, nil
}

func normalizeProviderType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "openai", "openai_compatible", "openaicompatible", "openai-compatible":
		return "openai_compatible"
	case "coze":
		return "coze"
	case "n8n":
		return "n8n"
	case "webhook":
		return "webhook"
	case "mock":
		return "mock"
	case "static":
		return "static"
	default:
		return ""
	}
}

func anyString(value any) string {
	if value == nil {
		return ""
	}

	return strings.TrimSpace(fmt.Sprint(value))
}

func normalizeStringList(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
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

func normalizeChatType(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(ingest.ChatTypeDirect):
		return string(ingest.ChatTypeDirect), nil
	case string(ingest.ChatTypeGroup):
		return string(ingest.ChatTypeGroup), nil
	case string(ingest.ChatTypeBroadcast):
		return string(ingest.ChatTypeBroadcast), nil
	case string(ingest.ChatTypeStatus):
		return string(ingest.ChatTypeStatus), nil
	default:
		return "", fmt.Errorf("unsupported scope_filter.chat_types value %q", value)
	}
}
