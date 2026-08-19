package agents

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"regexp"
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
	providerConfigInput := input.ProviderConfig
	if strings.TrimSpace(input.ID) != "" {
		existing, existingErr := s.repository.GetRuleByID(ctx, strings.TrimSpace(input.ID))
		if existingErr == nil {
			providerConfigInput = preserveProviderSecrets(providerConfigInput, existing.ProviderConfig)
		} else if !errors.Is(existingErr, sql.ErrNoRows) {
			return RuleView{}, mapRuleError(input.ID, existingErr)
		}
	}
	providerConfig, err := normalizeProviderConfig(providerConfigInput)
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

		return mapRuleToViewForContext(ctx, stored), nil
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

	return mapRuleToViewForContext(ctx, stored), nil
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

	return mapRuleToViewForContext(ctx, stored), nil
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

	return mapRuleToViewForContext(ctx, rule), nil
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
		existing, existingErr := s.repository.GetSettings(ctx, accountID)
		if existingErr == nil {
			apiKey = existing.APIKey
		} else if !errors.Is(existingErr, sql.ErrNoRows) {
			return SettingsView{}, mapSettingsError(accountID, existingErr)
		}
	}
	if apiKey == "" {
		return SettingsView{}, fmt.Errorf("api_key is required for a new configuration")
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
		view.ProviderConfig = redactProviderSecrets(view.ProviderConfig)
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

var providerSecretKeys = []string{"api_key", "authorization"}

func redactProviderSecrets(config map[string]any) map[string]any {
	result := make(map[string]any, len(config))
	for key, value := range config {
		result[key] = value
	}
	for _, key := range providerSecretKeys {
		if strings.TrimSpace(anyString(result[key])) != "" {
			result[key+"_configured"] = true
		}
		delete(result, key)
	}
	return result
}

func preserveProviderSecrets(incoming map[string]any, existing map[string]any) map[string]any {
	result := make(map[string]any, len(incoming)+len(providerSecretKeys))
	for key, value := range incoming {
		if strings.HasSuffix(key, "_configured") {
			continue
		}
		result[key] = value
	}

	if normalizeProviderType(anyString(result["type"])) != normalizeProviderType(anyString(existing["type"])) {
		return result
	}
	for _, key := range providerSecretKeys {
		if strings.TrimSpace(anyString(result[key])) == "" && strings.TrimSpace(anyString(existing[key])) != "" {
			result[key] = existing[key]
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

	for index := range items {
		items[index].ProviderConfig = redactProviderSecrets(items[index].ProviderConfig)
	}

	return items, nil
}

func (s *Service) ListSkills(ctx context.Context) ([]AgentSkill, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return nil, err
	}

	return s.repository.ListSkills(ctx)
}

func (s *Service) GetSkill(ctx context.Context, id string) (AgentSkill, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AgentSkill{}, err
	}

	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return AgentSkill{}, fmt.Errorf("skill id is required")
	}

	return s.repository.GetSkillByID(ctx, trimmedID)
}

func (s *Service) UpsertSkill(ctx context.Context, input UpsertSkillInput) (AgentSkill, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AgentSkill{}, err
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		return AgentSkill{}, fmt.Errorf("skill name is required")
	}

	slug := normalizeSkillSlug(input.Slug)
	if slug == "" {
		slug = normalizeSkillSlug(name)
	}
	if slug == "" {
		return AgentSkill{}, fmt.Errorf("skill slug is required")
	}

	markdown := strings.TrimSpace(input.SkillMarkdown)
	if markdown == "" {
		markdown = defaultSkillMarkdown(name, strings.TrimSpace(input.Description))
	}

	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = ids.NewUUID()
	}

	item := AgentSkill{
		ID:            id,
		Name:          limitText(name, 120),
		Slug:          limitText(slug, 120),
		Description:   limitText(input.Description, 1000),
		Enabled:       input.Enabled,
		SkillMarkdown: limitText(markdown, 20000),
	}
	if err := s.repository.UpsertSkill(ctx, item); err != nil {
		return AgentSkill{}, err
	}

	return s.repository.GetSkillByID(ctx, item.ID)
}

func (s *Service) DeleteSkill(ctx context.Context, id string) error {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return err
	}

	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return fmt.Errorf("skill id is required")
	}

	return s.repository.DeleteSkill(ctx, trimmedID)
}

func (s *Service) UpsertSkillFile(ctx context.Context, skillID string, input UpsertSkillFileInput) (AgentSkill, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AgentSkill{}, err
	}

	trimmedSkillID := strings.TrimSpace(skillID)
	if trimmedSkillID == "" {
		return AgentSkill{}, fmt.Errorf("skill id is required")
	}
	if _, err := s.repository.GetSkillByID(ctx, trimmedSkillID); err != nil {
		return AgentSkill{}, err
	}

	fileKind := normalizeSkillFileKind(input.FileKind)
	if fileKind == "" || fileKind == SkillFileKindSkill {
		return AgentSkill{}, fmt.Errorf("file_kind must be reference or asset")
	}

	path, err := normalizeSkillFilePath(input.Path, fileKind)
	if err != nil {
		return AgentSkill{}, err
	}

	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "text/plain; charset=utf-8"
	}
	contentText := limitText(input.ContentText, 120000)

	fileID := strings.TrimSpace(input.ID)
	if fileID == "" {
		fileID = ids.NewUUID()
	}
	file := SkillFile{
		ID:          fileID,
		SkillID:     trimmedSkillID,
		Path:        path,
		FileKind:    fileKind,
		ContentType: limitText(contentType, 160),
		ContentText: contentText,
		ByteSize:    int64(len([]byte(contentText))),
		SortOrder:   input.SortOrder,
	}
	if err := s.repository.UpsertSkillFile(ctx, file); err != nil {
		return AgentSkill{}, err
	}

	return s.repository.GetSkillByID(ctx, trimmedSkillID)
}

func (s *Service) DeleteSkillFile(ctx context.Context, skillID string, fileID string) (AgentSkill, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AgentSkill{}, err
	}

	trimmedSkillID := strings.TrimSpace(skillID)
	trimmedFileID := strings.TrimSpace(fileID)
	if trimmedSkillID == "" || trimmedFileID == "" {
		return AgentSkill{}, fmt.Errorf("skill id and file id are required")
	}
	if err := s.repository.DeleteSkillFile(ctx, trimmedSkillID, trimmedFileID); err != nil {
		return AgentSkill{}, err
	}

	return s.repository.GetSkillByID(ctx, trimmedSkillID)
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
	if systemPurposeUsesSingleActiveConfig(normalizedPurpose) && len(items) > 1 {
		items = items[:1]
	}

	for index := range items {
		items[index].ProviderConfig = publicProviderConfig(items[index].ProviderConfig)
		items[index].PromptTemplate = ""
	}

	return items, nil
}

func (s *Service) GetStatusCard(ctx context.Context, chatID string) (StatusCardView, error) {
	if _, err := auth.RequireUser(ctx); err != nil {
		return StatusCardView{}, err
	}

	trimmedID := strings.TrimSpace(chatID)
	if trimmedID == "" {
		return StatusCardView{}, fmt.Errorf("chat_id is required")
	}

	return s.repository.GetStatusCardByChatID(ctx, trimmedID)
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

	providerConfigInput := input.ProviderConfig
	configID := strings.TrimSpace(input.ID)
	if configID != "" {
		existing, existingErr := s.repository.GetSystemConfigByID(ctx, configID, "")
		if existingErr == nil {
			providerConfigInput = preserveProviderSecrets(providerConfigInput, existing.ProviderConfig)
		} else if !errors.Is(existingErr, sql.ErrNoRows) {
			return SystemAgentConfig{}, existingErr
		}
	}
	providerConfig, err := normalizeProviderConfig(providerConfigInput)
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
		ID:             configID,
		Name:           name,
		Purpose:        purpose,
		Enabled:        input.Enabled,
		ProviderConfig: providerConfig,
		PromptTemplate: strings.TrimSpace(input.PromptTemplate),
	}
	if purpose == AgentPurposeReply {
		config.SkillIDs = normalizeStringList(input.SkillIDs)
	}
	if config.ID == "" {
		config.ID = ids.NewUUID()
	}
	for _, skillID := range config.SkillIDs {
		if _, err := s.repository.GetSkillByID(ctx, skillID); err != nil {
			return SystemAgentConfig{}, fmt.Errorf("skill not found: %s", skillID)
		}
	}

	if err := s.repository.UpsertSystemConfig(ctx, config); err != nil {
		return SystemAgentConfig{}, err
	}
	if systemPurposeUsesSingleActiveConfig(purpose) && config.Enabled {
		if err := s.repository.DisableOtherSystemConfigs(ctx, purpose, config.ID); err != nil {
			return SystemAgentConfig{}, err
		}
	}

	stored, err := s.repository.GetSystemConfigByID(ctx, config.ID, purpose)
	if err != nil {
		return SystemAgentConfig{}, err
	}
	stored.ProviderConfig = redactProviderSecrets(stored.ProviderConfig)
	return stored, nil
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

func (s *Service) CreateUsageLog(ctx context.Context, input CreateAssistantUsageLogInput) (AssistantUsageLogView, error) {
	user, err := auth.RequireUser(ctx)
	if err != nil {
		return AssistantUsageLogView{}, err
	}

	action := normalizeAssistantUsageAction(input.ActionType)
	if action == "" {
		return AssistantUsageLogView{}, fmt.Errorf("unsupported action_type %q", input.ActionType)
	}

	finalDraft := strings.TrimSpace(input.FinalDraftContent)
	if finalDraft == "" && strings.TrimSpace(input.TranslatedContent) == "" {
		return AssistantUsageLogView{}, fmt.Errorf("final_draft_content is required")
	}

	now := s.now()
	logDate := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if value := strings.TrimSpace(input.LogDate); value != "" {
		parsed, err := time.Parse("2006-01-02", value)
		if err != nil {
			return AssistantUsageLogView{}, fmt.Errorf("log_date must use YYYY-MM-DD")
		}
		logDate = parsed
	}
	item := AssistantUsageLog{
		ID:                       ids.NewUUID(),
		UserID:                   user.ID,
		WSAccountID:              limitText(input.WSAccountID, 500),
		WSAccountName:            limitText(input.WSAccountName, 500),
		ChatID:                   limitText(input.ChatID, 500),
		CustomerID:               limitText(input.CustomerID, 500),
		CustomerNickname:         limitText(input.CustomerNickname, 500),
		LatestMessageID:          limitText(input.LatestMessageID, 500),
		LatestMessageType:        limitText(input.LatestMessageType, 80),
		LatestMessageText:        limitText(input.LatestMessageText, 8000),
		LatestMessageMediaRef:    limitText(input.LatestMessageMediaRef, 2000),
		LatestMessageReceivedAt:  input.LatestMessageReceivedAt,
		TriggerMessages:          normalizeUsageTriggerMessages(input.TriggerMessages),
		AgentID:                  limitText(input.AgentID, 500),
		AgentName:                limitText(input.AgentName, 500),
		AdoptedOptionIndex:       input.AdoptedOptionIndex,
		AdoptedOptionContent:     limitText(input.AdoptedOptionContent, 8000),
		TranslationSourceContent: limitText(input.TranslationSourceContent, 12000),
		FinalDraftContent:        limitText(finalDraft, 12000),
		TranslatedContent:        limitText(input.TranslatedContent, 12000),
		TargetLanguage:           limitText(input.TargetLanguage, 120),
		ActionType:               action,
		LogDate:                  logDate,
		CreatedAt:                now,
	}

	if item.AdoptedOptionIndex != nil && *item.AdoptedOptionIndex < 0 {
		return AssistantUsageLogView{}, fmt.Errorf("adopted_option_index must be 0 or greater")
	}

	if err := s.repository.CreateUsageLog(ctx, item); err != nil {
		return AssistantUsageLogView{}, err
	}

	return mapUsageLogToView(item), nil
}

func (s *Service) ListUsageLogs(ctx context.Context, filters AssistantUsageLogFilters) (AssistantUsageLogListResult, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AssistantUsageLogListResult{}, err
	}

	limit := filters.Limit
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}

	offset := filters.Offset
	if offset < 0 {
		offset = 0
	}

	action := normalizeAssistantUsageAction(filters.Action)
	if filters.Action != "" && action == "" {
		return AssistantUsageLogListResult{}, fmt.Errorf("unsupported action %q", filters.Action)
	}

	logDate := strings.TrimSpace(filters.LogDate)
	if logDate != "" {
		if _, err := time.Parse("2006-01-02", logDate); err != nil {
			return AssistantUsageLogListResult{}, fmt.Errorf("log_date must use YYYY-MM-DD")
		}
	}

	items, total, err := s.repository.ListUsageLogs(ctx, AssistantUsageLogFilters{
		LogDate:   logDate,
		UserID:    strings.TrimSpace(filters.UserID),
		AccountID: strings.TrimSpace(filters.AccountID),
		ChatID:    strings.TrimSpace(filters.ChatID),
		AgentID:   strings.TrimSpace(filters.AgentID),
		Action:    action,
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		return AssistantUsageLogListResult{}, err
	}

	return AssistantUsageLogListResult{
		Logs:   items,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

func (s *Service) ListUsageLogFilterOptions(ctx context.Context) (AssistantUsageLogFilterOptions, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return AssistantUsageLogFilterOptions{}, err
	}

	return s.repository.ListUsageLogFilterOptions(ctx)
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
	case string(AgentPurposeStatusCard):
		return AgentPurposeStatusCard
	default:
		return ""
	}
}

func systemPurposeUsesSingleActiveConfig(purpose AgentPurpose) bool {
	return purpose == AgentPurposeTranslation || purpose == AgentPurposeStatusCard
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

func normalizeAssistantUsageAction(value AssistantUsageAction) AssistantUsageAction {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(AssistantUsageActionWriteback):
		return AssistantUsageActionWriteback
	case string(AssistantUsageActionSend):
		return AssistantUsageActionSend
	default:
		return ""
	}
}

func mapUsageLogToView(item AssistantUsageLog) AssistantUsageLogView {
	return AssistantUsageLogView{
		ID:                       item.ID,
		UserID:                   item.UserID,
		WSAccountID:              item.WSAccountID,
		WSAccountName:            item.WSAccountName,
		ChatID:                   item.ChatID,
		CustomerID:               item.CustomerID,
		CustomerNickname:         item.CustomerNickname,
		LatestMessageID:          item.LatestMessageID,
		LatestMessageType:        item.LatestMessageType,
		LatestMessageText:        item.LatestMessageText,
		LatestMessageMediaRef:    item.LatestMessageMediaRef,
		LatestMessageReceivedAt:  item.LatestMessageReceivedAt,
		TriggerMessages:          item.TriggerMessages,
		AgentID:                  item.AgentID,
		AgentName:                item.AgentName,
		AdoptedOptionIndex:       item.AdoptedOptionIndex,
		AdoptedOptionContent:     item.AdoptedOptionContent,
		TranslationSourceContent: item.TranslationSourceContent,
		FinalDraftContent:        item.FinalDraftContent,
		TranslatedContent:        item.TranslatedContent,
		TargetLanguage:           item.TargetLanguage,
		ActionType:               item.ActionType,
		LogDate:                  item.LogDate.Format("2006-01-02"),
		CreatedAt:                item.CreatedAt,
	}
}

func normalizeUsageTriggerMessages(items []AssistantUsageTriggerMessage) []AssistantUsageTriggerMessage {
	result := make([]AssistantUsageTriggerMessage, 0, len(items))
	for _, item := range items {
		normalized := AssistantUsageTriggerMessage{
			ID:          limitText(item.ID, 500),
			WAMessageID: limitText(item.WAMessageID, 500),
			SenderJID:   limitText(item.SenderJID, 500),
			SenderName:  limitText(item.SenderName, 500),
			MessageType: limitText(item.MessageType, 80),
			TextContent: limitText(item.TextContent, 8000),
			MediaRef:    limitText(item.MediaRef, 2000),
			SentAt:      item.SentAt,
		}
		if normalized.ID == "" && normalized.WAMessageID == "" && normalized.TextContent == "" && normalized.MediaRef == "" {
			continue
		}
		result = append(result, normalized)
	}

	return result
}

func limitText(value string, maxRunes int) string {
	trimmed := strings.TrimSpace(value)
	if maxRunes <= 0 {
		return trimmed
	}

	runes := []rune(trimmed)
	if len(runes) <= maxRunes {
		return trimmed
	}

	return string(runes[:maxRunes])
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

var skillSlugReplacePattern = regexp.MustCompile(`[^a-z0-9_-]+`)

func normalizeSkillSlug(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, " ", "-")
	normalized = skillSlugReplacePattern.ReplaceAllString(normalized, "-")
	normalized = strings.Trim(normalized, "-_")
	return normalized
}

func defaultSkillMarkdown(name string, description string) string {
	lines := []string{
		"# " + strings.TrimSpace(name),
		"",
		"## 何时使用",
		"当客户消息与本技能的话术、知识或场景匹配时使用。",
		"",
		"## 回复目标",
		"结合 references 中的资料，生成自然、准确、适合 WhatsApp 客服场景的回复。",
		"",
		"## 使用要求",
		"- 优先参考本技能下的 references。",
		"- 不要编造资料中没有的承诺。",
		"- 不要输出内部分析过程。",
	}
	if strings.TrimSpace(description) != "" {
		lines = append([]string{
			"# " + strings.TrimSpace(name),
			"",
			"## 技能说明",
			strings.TrimSpace(description),
			"",
		}, lines[2:]...)
	}
	return strings.Join(lines, "\n")
}

func normalizeSkillFileKind(value SkillFileKind) SkillFileKind {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(SkillFileKindReference), "references":
		return SkillFileKindReference
	case string(SkillFileKindAsset), "assets":
		return SkillFileKindAsset
	default:
		return ""
	}
}

func normalizeSkillFilePath(value string, kind SkillFileKind) (string, error) {
	trimmed := strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	if trimmed == "" {
		return "", fmt.Errorf("file path is required")
	}
	trimmed = strings.TrimPrefix(trimmed, "/")
	cleaned := filepath.Clean(trimmed)
	cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || strings.Contains(cleaned, "/../") {
		return "", fmt.Errorf("invalid file path")
	}

	prefix := "references/"
	if kind == SkillFileKindAsset {
		prefix = "assets/"
	}
	if cleaned == strings.TrimSuffix(prefix, "/") {
		return "", fmt.Errorf("file path must include a file name")
	}
	if !strings.HasPrefix(cleaned, prefix) {
		cleaned = prefix + filepath.Base(cleaned)
		cleaned = strings.ReplaceAll(cleaned, "\\", "/")
	}
	return limitText(cleaned, 240), nil
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
