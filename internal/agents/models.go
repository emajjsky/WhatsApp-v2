package agents

import (
	"encoding/json"
	"time"
)

type ReplyMode string

const (
	ReplyModeManual   ReplyMode = "manual"
	ReplyModeSuggest  ReplyMode = "suggest"
	ReplyModeAutoSend ReplyMode = "auto_send"
)

type AgentPurpose string

const (
	AgentPurposeReply       AgentPurpose = "reply"
	AgentPurposeTranslation AgentPurpose = "translation"
	AgentPurposeStatusCard  AgentPurpose = "status_card"
)

type MatchMode string

const (
	MatchModeAny MatchMode = "any"
	MatchModeAll MatchMode = "all"
)

type ScopeFilter struct {
	ChatIDs   []string `json:"chat_ids"`
	ChatTypes []string `json:"chat_types"`
}

type TriggerFilter struct {
	Keywords        []string  `json:"keywords"`
	MatchMode       MatchMode `json:"match_mode,omitempty"`
	IgnoreFromMe    bool      `json:"ignore_from_me"`
	MinMessageChars int       `json:"min_message_chars"`
}

type BlacklistFilter struct {
	BlockedKeywords []string `json:"blocked_keywords"`
	SensitiveTopics []string `json:"sensitive_topics"`
}

type KnowledgeBinding struct {
	Summary    *string  `json:"summary,omitempty"`
	References []string `json:"references"`
}

type AgentRule struct {
	ID                      string
	AccountID               string
	AccountIDs              []string
	Purpose                 AgentPurpose
	Name                    string
	Enabled                 bool
	ScopeFilter             ScopeFilter
	TriggerFilter           TriggerFilter
	ReplyMode               ReplyMode
	CooldownSeconds         int
	MaxAutoRepliesPerThread int
	BlacklistFilter         BlacklistFilter
	PromptTemplate          string
	ProviderConfig          map[string]any
	KnowledgeBinding        *KnowledgeBinding
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type RuleView struct {
	ID                      string            `json:"id"`
	AccountID               string            `json:"account_id"`
	AccountIDs              []string          `json:"account_ids"`
	Purpose                 AgentPurpose      `json:"purpose"`
	Name                    string            `json:"name"`
	Enabled                 bool              `json:"enabled"`
	ScopeFilter             ScopeFilter       `json:"scope_filter"`
	TriggerFilter           TriggerFilter     `json:"trigger_filter"`
	ReplyMode               ReplyMode         `json:"reply_mode"`
	CooldownSeconds         int               `json:"cooldown_seconds"`
	MaxAutoRepliesPerThread int               `json:"max_auto_replies_per_thread"`
	BlacklistFilter         BlacklistFilter   `json:"blacklist_filter"`
	PromptTemplate          string            `json:"prompt_template"`
	ProviderConfig          map[string]any    `json:"provider_config"`
	KnowledgeBinding        *KnowledgeBinding `json:"knowledge_binding,omitempty"`
	CreatedAt               time.Time         `json:"created_at"`
	UpdatedAt               time.Time         `json:"updated_at"`
}

type UpsertRuleInput struct {
	ID                      string            `json:"id,omitempty"`
	AccountID               string            `json:"account_id"`
	AccountIDs              []string          `json:"account_ids,omitempty"`
	Purpose                 AgentPurpose      `json:"purpose,omitempty"`
	Name                    string            `json:"name"`
	Enabled                 bool              `json:"enabled"`
	ScopeFilter             ScopeFilter       `json:"scope_filter"`
	TriggerFilter           TriggerFilter     `json:"trigger_filter"`
	ReplyMode               ReplyMode         `json:"reply_mode"`
	CooldownSeconds         int               `json:"cooldown_seconds"`
	MaxAutoRepliesPerThread int               `json:"max_auto_replies_per_thread"`
	BlacklistFilter         BlacklistFilter   `json:"blacklist_filter"`
	PromptTemplate          string            `json:"prompt_template"`
	ProviderConfig          map[string]any    `json:"provider_config,omitempty"`
	KnowledgeBinding        *KnowledgeBinding `json:"knowledge_binding,omitempty"`
}

type AgentSettings struct {
	AccountID      string
	Provider       string
	Model          string
	BaseURL        string
	APIKey         string
	PromptTemplate string
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type SystemAgentConfig struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Purpose        AgentPurpose   `json:"purpose"`
	Enabled        bool           `json:"enabled"`
	ProviderConfig map[string]any `json:"provider_config"`
	PromptTemplate string         `json:"prompt_template"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
}

type UpsertSystemConfigInput struct {
	ID             string         `json:"id,omitempty"`
	Name           string         `json:"name"`
	Purpose        AgentPurpose   `json:"purpose"`
	Enabled        bool           `json:"enabled"`
	ProviderConfig map[string]any `json:"provider_config"`
	PromptTemplate string         `json:"prompt_template"`
}

type SettingsView struct {
	AccountID      string    `json:"account_id"`
	Provider       string    `json:"provider"`
	Model          string    `json:"model"`
	BaseURL        string    `json:"base_url"`
	APIKey         string    `json:"api_key"`
	PromptTemplate string    `json:"prompt_template"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type UpsertSettingsInput struct {
	AccountID      string `json:"account_id"`
	Provider       string `json:"provider"`
	Model          string `json:"model"`
	BaseURL        string `json:"base_url"`
	APIKey         string `json:"api_key"`
	PromptTemplate string `json:"prompt_template"`
}

type RuleListFilters struct {
	AccountID string
	Enabled   *bool
}

type RunStatus string

const (
	RunStatusQueued         RunStatus = "queued"
	RunStatusGenerating     RunStatus = "generating"
	RunStatusBlocked        RunStatus = "blocked"
	RunStatusReadyForReview RunStatus = "ready_for_review"
	RunStatusSent           RunStatus = "sent"
	RunStatusFailed         RunStatus = "failed"
)

type AgentRun struct {
	ID               string
	RuleID           string
	AccountID        string
	ChatID           string
	TriggerMessageID string
	Status           RunStatus
	InputContext     json.RawMessage
	OutputDraft      *string
	BlockReason      *string
	SentMessageID    *string
	CreatedAt        time.Time
	CompletedAt      *time.Time
}

type RunView struct {
	ID               string     `json:"id"`
	RuleID           string     `json:"rule_id"`
	RuleName         string     `json:"rule_name"`
	AccountID        string     `json:"account_id"`
	ChatID           string     `json:"chat_id"`
	ChatTitle        *string    `json:"chat_title,omitempty"`
	WAChatJID        *string    `json:"wa_chat_jid,omitempty"`
	TriggerMessageID string     `json:"trigger_message_id"`
	TriggerPreview   *string    `json:"trigger_preview,omitempty"`
	Status           RunStatus  `json:"status"`
	OutputDraft      *string    `json:"output_draft,omitempty"`
	BlockReason      *string    `json:"block_reason,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	CompletedAt      *time.Time `json:"completed_at,omitempty"`
}

type RunListFilters struct {
	AccountID string
	RuleID    string
	ChatID    string
	Status    RunStatus
	Limit     int
	Offset    int
}

type RunListResult struct {
	Runs   []RunView `json:"runs"`
	Total  int       `json:"total"`
	Limit  int       `json:"limit"`
	Offset int       `json:"offset"`
}

type AssistantUsageAction string

const (
	AssistantUsageActionWriteback AssistantUsageAction = "writeback"
	AssistantUsageActionSend      AssistantUsageAction = "send"
)

type AssistantUsageLog struct {
	ID                      string
	UserID                  string
	WSAccountID             string
	WSAccountName           string
	ChatID                  string
	CustomerID              string
	CustomerNickname        string
	LatestMessageID         string
	LatestMessageType       string
	LatestMessageText       string
	LatestMessageMediaRef   string
	LatestMessageReceivedAt *time.Time
	TriggerMessages         []AssistantUsageTriggerMessage
	AgentID                 string
	AgentName               string
	AdoptedOptionIndex      *int
	AdoptedOptionContent    string
	TranslationSourceContent string
	FinalDraftContent       string
	TranslatedContent       string
	TargetLanguage          string
	ActionType              AssistantUsageAction
	LogDate                 time.Time
	CreatedAt               time.Time
}

type AssistantUsageLogView struct {
	ID                      string               `json:"id"`
	UserID                  string               `json:"user_id"`
	WSAccountID             string               `json:"ws_account_id"`
	WSAccountName           string               `json:"ws_account_name"`
	ChatID                  string               `json:"chat_id"`
	CustomerID              string               `json:"customer_id"`
	CustomerNickname        string               `json:"customer_nickname"`
	LatestMessageID         string               `json:"latest_message_id"`
	LatestMessageType       string               `json:"latest_message_type"`
	LatestMessageText       string               `json:"latest_message_text"`
	LatestMessageMediaRef   string               `json:"latest_message_media_ref"`
	LatestMessageReceivedAt *time.Time           `json:"latest_message_received_at,omitempty"`
	TriggerMessages         []AssistantUsageTriggerMessage `json:"trigger_messages"`
	AgentID                 string               `json:"agent_id"`
	AgentName               string               `json:"agent_name"`
	AdoptedOptionIndex      *int                 `json:"adopted_option_index,omitempty"`
	AdoptedOptionContent    string               `json:"adopted_option_content"`
	TranslationSourceContent string              `json:"translation_source_content"`
	FinalDraftContent       string               `json:"final_draft_content"`
	TranslatedContent       string               `json:"translated_content"`
	TargetLanguage          string               `json:"target_language"`
	ActionType              AssistantUsageAction `json:"action_type"`
	LogDate                 string               `json:"log_date"`
	CreatedAt               time.Time            `json:"created_at"`
}

type CreateAssistantUsageLogInput struct {
	WSAccountID             string               `json:"ws_account_id"`
	WSAccountName           string               `json:"ws_account_name"`
	ChatID                  string               `json:"chat_id"`
	CustomerID              string               `json:"customer_id"`
	CustomerNickname        string               `json:"customer_nickname"`
	LatestMessageID         string               `json:"latest_message_id"`
	LatestMessageType       string               `json:"latest_message_type"`
	LatestMessageText       string               `json:"latest_message_text"`
	LatestMessageMediaRef   string               `json:"latest_message_media_ref"`
	LatestMessageReceivedAt *time.Time           `json:"latest_message_received_at,omitempty"`
	TriggerMessages         []AssistantUsageTriggerMessage `json:"trigger_messages"`
	AgentID                 string               `json:"agent_id"`
	AgentName               string               `json:"agent_name"`
	AdoptedOptionIndex      *int                 `json:"adopted_option_index,omitempty"`
	AdoptedOptionContent    string               `json:"adopted_option_content"`
	TranslationSourceContent string              `json:"translation_source_content"`
	FinalDraftContent       string               `json:"final_draft_content"`
	TranslatedContent       string               `json:"translated_content"`
	TargetLanguage          string               `json:"target_language"`
	ActionType              AssistantUsageAction `json:"action_type"`
}

type AssistantUsageTriggerMessage struct {
	ID          string    `json:"id"`
	WAMessageID string    `json:"wa_message_id"`
	SenderJID   string    `json:"sender_jid"`
	SenderName  string    `json:"sender_name,omitempty"`
	MessageType string    `json:"message_type"`
	TextContent string    `json:"text_content,omitempty"`
	MediaRef    string    `json:"media_ref,omitempty"`
	SentAt      time.Time `json:"sent_at"`
}

type AssistantUsageLogFilters struct {
	LogDate   string
	UserID    string
	AccountID string
	ChatID    string
	AgentID   string
	Action    AssistantUsageAction
	Limit     int
	Offset    int
}

type AssistantUsageLogListResult struct {
	Logs   []AssistantUsageLogView `json:"logs"`
	Total  int                     `json:"total"`
	Limit  int                     `json:"limit"`
	Offset int                     `json:"offset"`
}

type AssistantUsageLogFilterOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type AssistantUsageLogFilterOptions struct {
	Accounts []AssistantUsageLogFilterOption `json:"accounts"`
	Agents   []AssistantUsageLogFilterOption `json:"agents"`
}

type RunStatusUpdate struct {
	Status        RunStatus
	OutputDraft   *string
	BlockReason   *string
	SentMessageID *string
	CompletedAt   *time.Time
}

type DesktopAgentMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type DesktopAgentDraftInput struct {
	RequestID           string                `json:"request_id,omitempty"`
	AccountID           string                `json:"account_id"`
	ChatID              string                `json:"chat_id"`
	ChatTitle           *string               `json:"chat_title,omitempty"`
	TriggerMessageID    string                `json:"trigger_message_id"`
	MessageText         string                `json:"message_text"`
	AgentID             string                `json:"agent_id,omitempty"`
	ContextEnabled      bool                  `json:"context_enabled"`
	ContextMessageLimit int                   `json:"context_message_limit,omitempty"`
	RecentMessages      []DesktopAgentMessage `json:"recent_messages,omitempty"`
}

type DesktopAgentDraftResult struct {
	RequestID   string         `json:"request_id"`
	AgentID     string         `json:"agent_id"`
	AgentName   string         `json:"agent_name"`
	Status      RunStatus      `json:"status"`
	Draft       string         `json:"draft,omitempty"`
	BlockReason string         `json:"block_reason,omitempty"`
	Provider    map[string]any `json:"provider,omitempty"`
	CompletedAt time.Time      `json:"completed_at"`
}

type DesktopAgentTranslationInput struct {
	RequestID          string `json:"request_id,omitempty"`
	AccountID          string `json:"account_id"`
	AgentID            string `json:"agent_id,omitempty"`
	Text               string `json:"text"`
	TargetLanguage     string `json:"target_language"`
	TargetLanguageName string `json:"target_language_name,omitempty"`
}

type DesktopAgentStatusCardInput struct {
	RequestID           string                `json:"request_id,omitempty"`
	AccountID           string                `json:"account_id"`
	ChatID              string                `json:"chat_id"`
	ChatTitle           *string               `json:"chat_title,omitempty"`
	AgentID             string                `json:"agent_id,omitempty"`
	ContextMessageLimit int                   `json:"context_message_limit,omitempty"`
	RecentMessages      []DesktopAgentMessage `json:"recent_messages,omitempty"`
}

func mapRuleToView(rule AgentRule) RuleView {
	view := RuleView{
		ID:                      rule.ID,
		AccountID:               rule.AccountID,
		AccountIDs:              rule.AccountIDs,
		Purpose:                 rule.Purpose,
		Name:                    rule.Name,
		Enabled:                 rule.Enabled,
		ScopeFilter:             rule.ScopeFilter,
		TriggerFilter:           rule.TriggerFilter,
		ReplyMode:               rule.ReplyMode,
		CooldownSeconds:         rule.CooldownSeconds,
		MaxAutoRepliesPerThread: rule.MaxAutoRepliesPerThread,
		BlacklistFilter:         rule.BlacklistFilter,
		PromptTemplate:          rule.PromptTemplate,
		ProviderConfig:          rule.ProviderConfig,
		KnowledgeBinding:        rule.KnowledgeBinding,
		CreatedAt:               rule.CreatedAt,
		UpdatedAt:               rule.UpdatedAt,
	}

	if view.ScopeFilter.ChatIDs == nil {
		view.ScopeFilter.ChatIDs = make([]string, 0)
	}
	if view.AccountIDs == nil {
		view.AccountIDs = []string{view.AccountID}
	}
	if view.ScopeFilter.ChatTypes == nil {
		view.ScopeFilter.ChatTypes = make([]string, 0)
	}
	if view.TriggerFilter.Keywords == nil {
		view.TriggerFilter.Keywords = make([]string, 0)
	}
	if view.BlacklistFilter.BlockedKeywords == nil {
		view.BlacklistFilter.BlockedKeywords = make([]string, 0)
	}
	if view.BlacklistFilter.SensitiveTopics == nil {
		view.BlacklistFilter.SensitiveTopics = make([]string, 0)
	}
	if view.ProviderConfig == nil {
		view.ProviderConfig = make(map[string]any)
	}
	if view.KnowledgeBinding != nil && view.KnowledgeBinding.References == nil {
		view.KnowledgeBinding.References = make([]string, 0)
	}

	return view
}

func mapSettingsToView(settings AgentSettings) SettingsView {
	return SettingsView{
		AccountID:      settings.AccountID,
		Provider:       settings.Provider,
		Model:          settings.Model,
		BaseURL:        settings.BaseURL,
		APIKey:         settings.APIKey,
		PromptTemplate: settings.PromptTemplate,
		CreatedAt:      settings.CreatedAt,
		UpdatedAt:      settings.UpdatedAt,
	}
}
