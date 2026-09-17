package agents

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
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
	for _, key := range []string{"type", "model", "preset_id", "enable_thinking"} {
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
	if strings.TrimSpace(anyString(result["preset_id"])) != "" {
		return result
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
	if input.Enabled {
		if err := s.validateSystemProviderConfig(ctx, providerConfig); err != nil {
			return SystemAgentConfig{}, err
		}
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

func (s *Service) ListProviderPresets(ctx context.Context) ([]ProviderPreset, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return nil, err
	}
	return s.repository.ListProviderPresets(ctx)
}

func (s *Service) UpsertProviderPreset(ctx context.Context, input UpsertProviderPresetInput) (ProviderPreset, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return ProviderPreset{}, err
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		return ProviderPreset{}, fmt.Errorf("provider preset name is required")
	}
	if len([]rune(name)) > 80 {
		return ProviderPreset{}, fmt.Errorf("provider preset name is too long")
	}
	providerType := normalizeProviderType(input.ProviderType)
	if providerType == "" || providerType == "mock" || providerType == "static" {
		return ProviderPreset{}, fmt.Errorf("unsupported provider preset type %q", input.ProviderType)
	}
	models := normalizeStringList(input.Models)
	defaultModel := strings.TrimSpace(input.DefaultModel)
	if defaultModel != "" && !containsString(models, defaultModel) {
		models = append(models, defaultModel)
	}
	textEnabled := true
	if input.TextEnabled != nil {
		textEnabled = *input.TextEnabled
	}
	if (providerType == "openai_compatible" || providerType == "openrouter") && textEnabled && len(models) == 0 {
		return ProviderPreset{}, fmt.Errorf("OpenAI-compatible preset requires at least one model")
	}
	baseURL := strings.TrimSpace(input.BaseURL)
	if len([]rune(baseURL)) > 500 {
		return ProviderPreset{}, fmt.Errorf("base_url is too long")
	}

	id := strings.TrimSpace(input.ID)
	if id == "" {
		id = ids.NewUUID()
	} else if existing, err := s.repository.GetProviderPresetByID(ctx, id); err == nil {
		if strings.TrimSpace(input.APIKey) == "" {
			input.APIKey = existing.APIKey
		}
		if input.TextEnabled == nil {
			textEnabled = existing.TextEnabled
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return ProviderPreset{}, err
	}
	asrEnabled := input.ASREnabled
	asrModel := strings.TrimSpace(input.ASRModel)
	asrBaseURL := strings.TrimSpace(input.ASRBaseURL)
	if textEnabled == asrEnabled {
		return ProviderPreset{}, fmt.Errorf("Provider 必须且只能选择文本模型或语音转写能力")
	}
	if providerType == "openrouter" && textEnabled {
		return ProviderPreset{}, fmt.Errorf("OpenRouter Provider 当前仅用于语音转写")
	}
	if asrEnabled {
		if providerType != "openai_compatible" && providerType != "openrouter" {
			return ProviderPreset{}, fmt.Errorf("语音转写目前仅支持 OpenAI-compatible 或 OpenRouter Provider")
		}
		if asrModel == "" {
			return ProviderPreset{}, fmt.Errorf("启用语音转写时必须填写 ASR 模型")
		}
		if providerType == "openrouter" {
			if _, err := openRouterChatCompletionsURL(firstNonEmpty(asrBaseURL, baseURL)); err != nil {
				return ProviderPreset{}, err
			}
		} else {
			if _, err := openAIAudioTranscriptionsURL(firstNonEmpty(asrBaseURL, baseURL)); err != nil {
				return ProviderPreset{}, err
			}
		}
	}
	if len([]rune(asrBaseURL)) > 500 {
		return ProviderPreset{}, fmt.Errorf("asr_base_url is too long")
	}
	if strings.TrimSpace(input.APIKey) == "" && (textEnabled || asrEnabled) && (providerType == "openai_compatible" || providerType == "openrouter") {
		return ProviderPreset{}, fmt.Errorf("Provider 必须配置 API Key")
	}
	if !asrEnabled {
		asrBaseURL = ""
		asrModel = ""
	}
	if !textEnabled {
		models = nil
		defaultModel = ""
	}
	preset := ProviderPreset{
		ID:           id,
		Name:         name,
		ProviderType: providerType,
		BaseURL:      baseURL,
		APIKey:       strings.TrimSpace(input.APIKey),
		TextEnabled:  textEnabled,
		Models:       models,
		DefaultModel: defaultModel,
		ASREnabled:   asrEnabled,
		ASRBaseURL:   asrBaseURL,
		ASRModel:     asrModel,
		IsDefaultASR: input.IsDefaultASR && asrEnabled && input.Enabled,
		Enabled:      input.Enabled,
	}
	if err := s.repository.UpsertProviderPreset(ctx, preset); err != nil {
		return ProviderPreset{}, err
	}
	return s.repository.GetProviderPresetByID(ctx, id)
}

func (s *Service) TranscribeAudio(
	ctx context.Context,
	providerID string,
	fileName string,
	mimeType string,
	audio []byte,
) (AudioTranscription, error) {
	if _, err := auth.RequireUser(ctx); err != nil {
		return AudioTranscription{}, err
	}
	providerID = strings.TrimSpace(providerID)
	if providerID != "" {
		if _, err := auth.RequireAdmin(ctx); err != nil {
			return AudioTranscription{}, err
		}
	}
	if len(audio) == 0 {
		return AudioTranscription{}, fmt.Errorf("语音文件不能为空")
	}
	if len(audio) > 25<<20 {
		return AudioTranscription{}, fmt.Errorf("语音文件不能超过 25 MB")
	}

	var (
		preset ProviderPreset
		err    error
	)
	if providerID != "" {
		preset, err = s.repository.GetProviderPresetByID(ctx, providerID)
	} else {
		preset, err = s.repository.GetDefaultASRProvider(ctx)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return AudioTranscription{}, fmt.Errorf("管理员后台还没有配置默认语音转写 Provider")
	}
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("加载语音转写 Provider 失败: %w", err)
	}
	if !preset.ASREnabled || (providerID == "" && !preset.Enabled) {
		return AudioTranscription{}, fmt.Errorf("Provider %q 未启用语音转写", preset.Name)
	}
	if preset.ProviderType != "openai_compatible" && preset.ProviderType != "openrouter" {
		return AudioTranscription{}, fmt.Errorf("Provider %q 不支持语音转写", preset.Name)
	}
	if strings.TrimSpace(preset.APIKey) == "" || strings.TrimSpace(preset.ASRModel) == "" {
		return AudioTranscription{}, fmt.Errorf("Provider %q 的 ASR API Key 或模型未配置完整", preset.Name)
	}

	if preset.ProviderType == "openrouter" {
		return transcribeAudioWithOpenRouter(ctx, preset, fileName, mimeType, audio)
	}

	endpoint, err := openAIAudioTranscriptionsURL(firstNonEmpty(preset.ASRBaseURL, preset.BaseURL))
	if err != nil {
		return AudioTranscription{}, err
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	fileName = safeAudioFileName(fileName, mimeType)
	filePart, err := writer.CreateFormFile("file", fileName)
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("创建语音上传内容失败: %w", err)
	}
	if _, err := filePart.Write(audio); err != nil {
		return AudioTranscription{}, fmt.Errorf("写入语音上传内容失败: %w", err)
	}
	if err := writer.WriteField("model", preset.ASRModel); err != nil {
		return AudioTranscription{}, fmt.Errorf("写入 ASR 模型失败: %w", err)
	}
	if err := writer.WriteField("response_format", "json"); err != nil {
		return AudioTranscription{}, fmt.Errorf("写入 ASR 响应格式失败: %w", err)
	}
	if err := writer.Close(); err != nil {
		return AudioTranscription{}, fmt.Errorf("完成语音上传内容失败: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("创建语音转写请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+preset.APIKey)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "whatsapp-agent-platform/asr")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("语音转写连接失败: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("读取语音转写结果失败: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return AudioTranscription{}, fmt.Errorf("语音转写失败: Provider 返回 HTTP %d: %s", resp.StatusCode, providerErrorMessage(responseBody))
	}

	var result struct {
		Text     string `json:"text"`
		Language string `json:"language"`
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return AudioTranscription{}, fmt.Errorf("解析语音转写结果失败: Provider 返回的不是有效 JSON")
	}
	result.Text = strings.TrimSpace(result.Text)
	if result.Text == "" {
		return AudioTranscription{}, fmt.Errorf("语音转写结果为空")
	}
	return AudioTranscription{
		Text:               result.Text,
		SourceLanguageCode: strings.TrimSpace(result.Language),
		ProviderName:       preset.Name,
		Model:              preset.ASRModel,
	}, nil
}

func transcribeAudioWithOpenRouter(
	ctx context.Context,
	preset ProviderPreset,
	fileName string,
	mimeType string,
	audio []byte,
) (AudioTranscription, error) {
	endpoint, err := openRouterChatCompletionsURL(firstNonEmpty(preset.ASRBaseURL, preset.BaseURL))
	if err != nil {
		return AudioTranscription{}, err
	}
	payload := map[string]any{
		"model": preset.ASRModel,
		"messages": []map[string]any{{
			"role": "user",
			"content": []map[string]any{
				{
					"type": "text",
					"text": "Transcribe this audio verbatim in its original language. Do not translate or summarize it. Return only one compact JSON object with this schema: {\"text\":\"exact transcription\",\"language\":\"ISO 639-1 language code\"}.",
				},
				{
					"type": "input_audio",
					"input_audio": map[string]string{
						"data":   base64.StdEncoding.EncodeToString(audio),
						"format": openRouterAudioFormat(fileName, mimeType),
					},
				},
			},
		}},
		"stream":      false,
		"temperature": 0,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("创建 OpenRouter 语音转写内容失败: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("创建 OpenRouter 语音转写请求失败: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+preset.APIKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Title", "WhatsApp Agent Platform")
	req.Header.Set("User-Agent", "whatsapp-agent-platform/openrouter-asr")

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("OpenRouter 语音转写连接失败: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return AudioTranscription{}, fmt.Errorf("读取 OpenRouter 语音转写结果失败: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return AudioTranscription{}, fmt.Errorf("OpenRouter 语音转写失败: HTTP %d: %s", resp.StatusCode, providerErrorMessage(responseBody))
	}
	text, language, err := parseOpenRouterTranscription(responseBody)
	if err != nil {
		return AudioTranscription{}, err
	}
	return AudioTranscription{
		Text:               text,
		SourceLanguageCode: language,
		ProviderName:       preset.Name,
		Model:              preset.ASRModel,
	}, nil
}

func openRouterChatCompletionsURL(baseURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		trimmed = "https://openrouter.ai/api/v1"
	}
	for _, suffix := range []string{"/models", "/audio/transcriptions"} {
		trimmed = strings.TrimSuffix(trimmed, suffix)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("OpenRouter Base URL 必须是有效的 HTTP 或 HTTPS 地址")
	}
	if strings.HasSuffix(trimmed, "/chat/completions") {
		return trimmed, nil
	}
	if !strings.HasSuffix(trimmed, "/api/v1") && !strings.HasSuffix(trimmed, "/v1") {
		trimmed += "/api/v1"
	}
	return trimmed + "/chat/completions", nil
}

func openRouterAudioFormat(fileName, mimeType string) string {
	mediaType := strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	formats := map[string]string{
		"audio/aac": "aac", "audio/aiff": "aiff", "audio/flac": "flac",
		"audio/m4a": "m4a", "audio/mp4": "m4a", "audio/mpeg": "mp3",
		"audio/ogg": "ogg", "audio/opus": "ogg", "audio/wav": "wav",
		"audio/webm": "ogg", "audio/x-wav": "wav",
	}
	if format := formats[mediaType]; format != "" {
		return format
	}
	extension := strings.TrimPrefix(strings.ToLower(filepath.Ext(fileName)), ".")
	if extension == "webm" || extension == "opus" {
		return "ogg"
	}
	if extension != "" {
		return extension
	}
	return "ogg"
}

func parseOpenRouterTranscription(body []byte) (string, string, error) {
	var response struct {
		Choices []struct {
			Message struct {
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &response); err != nil || len(response.Choices) == 0 {
		return "", "", fmt.Errorf("解析 OpenRouter 语音转写结果失败")
	}
	content := openRouterMessageContent(response.Choices[0].Message.Content)
	if content == "" {
		return "", "", fmt.Errorf("OpenRouter 语音转写结果为空")
	}
	cleaned := strings.TrimSpace(content)
	cleaned = strings.TrimPrefix(cleaned, "```json")
	cleaned = strings.TrimPrefix(cleaned, "```")
	cleaned = strings.TrimSuffix(cleaned, "```")
	cleaned = strings.TrimSpace(cleaned)
	if start, end := strings.Index(cleaned, "{"), strings.LastIndex(cleaned, "}"); start >= 0 && end > start {
		var result struct {
			Text     string `json:"text"`
			Language string `json:"language"`
		}
		if json.Unmarshal([]byte(cleaned[start:end+1]), &result) == nil && strings.TrimSpace(result.Text) != "" {
			return strings.TrimSpace(result.Text), strings.TrimSpace(result.Language), nil
		}
	}
	return cleaned, "", nil
}

func openRouterMessageContent(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) == nil {
		return strings.TrimSpace(text)
	}
	var parts []struct {
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &parts) == nil {
		values := make([]string, 0, len(parts))
		for _, part := range parts {
			if value := strings.TrimSpace(part.Text); value != "" {
				values = append(values, value)
			}
		}
		return strings.Join(values, "\n")
	}
	return ""
}

func openAIAudioTranscriptionsURL(baseURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	for _, suffix := range []string{"/chat/completions", "/models"} {
		trimmed = strings.TrimSuffix(trimmed, suffix)
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("ASR Base URL 必须是有效的 HTTP 或 HTTPS 地址")
	}
	if strings.HasSuffix(trimmed, "/audio/transcriptions") {
		return trimmed, nil
	}
	if !strings.HasSuffix(trimmed, "/v1") {
		trimmed += "/v1"
	}
	return trimmed + "/audio/transcriptions", nil
}

func safeAudioFileName(fileName, mimeType string) string {
	fileName = strings.TrimSpace(filepath.Base(fileName))
	if fileName != "" && fileName != "." {
		return fileName
	}
	switch strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0])) {
	case "audio/mpeg":
		return "voice.mp3"
	case "audio/wav", "audio/x-wav":
		return "voice.wav"
	case "audio/mp4", "audio/m4a":
		return "voice.m4a"
	case "audio/webm":
		return "voice.webm"
	default:
		return "voice.ogg"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func providerErrorMessage(body []byte) string {
	var payload struct {
		Error any `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil {
		switch value := payload.Error.(type) {
		case string:
			if strings.TrimSpace(value) != "" {
				return strings.TrimSpace(value)
			}
		case map[string]any:
			if message := strings.TrimSpace(anyString(value["message"])); message != "" {
				return message
			}
		}
	}
	message := strings.TrimSpace(string(body))
	if len(message) > 300 {
		message = message[:300]
	}
	if message == "" {
		return "未返回错误详情"
	}
	return message
}

func (s *Service) DiscoverProviderModels(ctx context.Context, input DiscoverProviderModelsInput) (DiscoverProviderModelsResult, error) {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return DiscoverProviderModelsResult{}, err
	}

	presetID := strings.TrimSpace(input.ID)
	providerType := normalizeProviderType(input.ProviderType)
	baseURL := strings.TrimSpace(input.BaseURL)
	apiKey := strings.TrimSpace(input.APIKey)
	if presetID != "" {
		preset, err := s.repository.GetProviderPresetByID(ctx, presetID)
		if err != nil {
			return DiscoverProviderModelsResult{}, fmt.Errorf("provider preset not found: %w", err)
		}
		if providerType == "" {
			providerType = normalizeProviderType(preset.ProviderType)
		}
		if baseURL == "" {
			baseURL = strings.TrimSpace(preset.BaseURL)
		}
		if apiKey == "" {
			apiKey = strings.TrimSpace(preset.APIKey)
		}
	}

	if providerType == "" {
		providerType = "openai_compatible"
	}
	if providerType != "openai_compatible" {
		return DiscoverProviderModelsResult{}, fmt.Errorf("当前 Provider 类型不支持模型检测，请使用 OpenAI-compatible")
	}
	if baseURL == "" {
		return DiscoverProviderModelsResult{}, fmt.Errorf("Base URL 不能为空")
	}
	if apiKey == "" {
		return DiscoverProviderModelsResult{}, fmt.Errorf("API Key 不能为空")
	}

	modelsURL, err := openAIModelsURL(baseURL)
	if err != nil {
		return DiscoverProviderModelsResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, modelsURL, nil)
	if err != nil {
		return DiscoverProviderModelsResult{}, fmt.Errorf("创建模型检测请求失败: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("User-Agent", "whatsapp-agent-platform/provider-model-discovery")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return DiscoverProviderModelsResult{}, fmt.Errorf("模型检测连接失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return DiscoverProviderModelsResult{}, fmt.Errorf("模型检测失败: Provider 返回 HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return DiscoverProviderModelsResult{}, fmt.Errorf("读取模型列表失败: %w", err)
	}
	models, err := parseProviderModels(body)
	if err != nil {
		return DiscoverProviderModelsResult{}, err
	}
	if len(models) == 0 {
		return DiscoverProviderModelsResult{}, fmt.Errorf("Provider 返回的模型列表为空")
	}

	return DiscoverProviderModelsResult{Models: models}, nil
}

func openAIModelsURL(baseURL string) (string, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(trimmed, "/chat/completions") {
		trimmed = strings.TrimSuffix(trimmed, "/chat/completions")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || strings.TrimSpace(parsed.Host) == "" {
		return "", fmt.Errorf("Base URL 必须是有效的 HTTP 或 HTTPS 地址")
	}
	if strings.HasSuffix(trimmed, "/models") {
		return trimmed, nil
	}
	if !strings.HasSuffix(trimmed, "/v1") {
		trimmed += "/v1"
	}
	return trimmed + "/models", nil
}

func parseProviderModels(body []byte) ([]string, error) {
	var envelope struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
		Models []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return nil, fmt.Errorf("解析模型列表失败: Provider 返回的不是有效 JSON")
	}

	items := envelope.Data
	if len(items) == 0 {
		items = envelope.Models
	}
	models := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		model := strings.TrimSpace(item.ID)
		if model == "" {
			model = strings.TrimSpace(item.Name)
		}
		if model == "" {
			continue
		}
		if _, exists := seen[model]; exists {
			continue
		}
		seen[model] = struct{}{}
		models = append(models, model)
	}
	return models, nil
}

func (s *Service) DeleteProviderPreset(ctx context.Context, id string) error {
	if _, err := auth.RequireAdmin(ctx); err != nil {
		return err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return fmt.Errorf("provider preset id is required")
	}
	inUse, err := s.repository.ProviderPresetInUse(ctx, id)
	if err != nil {
		return err
	}
	if inUse {
		return fmt.Errorf("该 Provider 正在被智能体使用，请先为相关智能体切换 Provider")
	}
	return s.repository.DeleteProviderPreset(ctx, id)
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

func (s *Service) validateSystemProviderConfig(ctx context.Context, config map[string]any) error {
	presetID := strings.TrimSpace(anyString(config["preset_id"]))
	if presetID == "" {
		return fmt.Errorf("provider_config.preset_id is required; select a Provider preset")
	}

	preset, err := s.repository.GetProviderPresetByID(ctx, presetID)
	if err != nil {
		return fmt.Errorf("provider preset %q not found: %w", presetID, err)
	}
	if !preset.Enabled {
		return fmt.Errorf("provider preset %q is disabled", preset.Name)
	}
	if !preset.TextEnabled {
		return fmt.Errorf("provider preset %q 未启用文本模型能力", preset.Name)
	}

	providerType := normalizeProviderType(anyString(config["type"]))
	if providerType != preset.ProviderType {
		return fmt.Errorf("provider type does not match Provider preset %q", preset.Name)
	}
	if providerType != "openai_compatible" {
		return nil
	}
	if strings.TrimSpace(preset.APIKey) == "" {
		return fmt.Errorf("provider preset %q has no API key; configure it first", preset.Name)
	}

	model := strings.TrimSpace(anyString(config["model"]))
	if model == "" {
		model = strings.TrimSpace(preset.DefaultModel)
		if model == "" && len(preset.Models) > 0 {
			model = strings.TrimSpace(preset.Models[0])
		}
		if model != "" {
			config["model"] = model
		}
	}
	if model == "" {
		return fmt.Errorf("provider preset %q has no default model", preset.Name)
	}
	if len(preset.Models) > 0 && !containsString(preset.Models, model) {
		return fmt.Errorf("model %q is not available in Provider preset %q", model, preset.Name)
	}

	return nil
}

func normalizeProviderType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "openai", "openai_compatible", "openaicompatible", "openai-compatible":
		return "openai_compatible"
	case "openrouter", "open_router", "open-router":
		return "openrouter"
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
