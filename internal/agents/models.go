package agents

import (
	"encoding/json"
	"time"
)

type ReplyMode string

const (
	ReplyModeSuggest  ReplyMode = "suggest"
	ReplyModeAutoSend ReplyMode = "auto_send"
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
	Name                    string
	Enabled                 bool
	ScopeFilter             ScopeFilter
	TriggerFilter           TriggerFilter
	ReplyMode               ReplyMode
	CooldownSeconds         int
	MaxAutoRepliesPerThread int
	BlacklistFilter         BlacklistFilter
	PromptTemplate          string
	KnowledgeBinding        *KnowledgeBinding
	CreatedAt               time.Time
	UpdatedAt               time.Time
}

type RuleView struct {
	ID                      string            `json:"id"`
	AccountID               string            `json:"account_id"`
	Name                    string            `json:"name"`
	Enabled                 bool              `json:"enabled"`
	ScopeFilter             ScopeFilter       `json:"scope_filter"`
	TriggerFilter           TriggerFilter     `json:"trigger_filter"`
	ReplyMode               ReplyMode         `json:"reply_mode"`
	CooldownSeconds         int               `json:"cooldown_seconds"`
	MaxAutoRepliesPerThread int               `json:"max_auto_replies_per_thread"`
	BlacklistFilter         BlacklistFilter   `json:"blacklist_filter"`
	PromptTemplate          string            `json:"prompt_template"`
	KnowledgeBinding        *KnowledgeBinding `json:"knowledge_binding,omitempty"`
	CreatedAt               time.Time         `json:"created_at"`
	UpdatedAt               time.Time         `json:"updated_at"`
}

type UpsertRuleInput struct {
	ID                      string            `json:"id,omitempty"`
	AccountID               string            `json:"account_id"`
	Name                    string            `json:"name"`
	Enabled                 bool              `json:"enabled"`
	ScopeFilter             ScopeFilter       `json:"scope_filter"`
	TriggerFilter           TriggerFilter     `json:"trigger_filter"`
	ReplyMode               ReplyMode         `json:"reply_mode"`
	CooldownSeconds         int               `json:"cooldown_seconds"`
	MaxAutoRepliesPerThread int               `json:"max_auto_replies_per_thread"`
	BlacklistFilter         BlacklistFilter   `json:"blacklist_filter"`
	PromptTemplate          string            `json:"prompt_template"`
	KnowledgeBinding        *KnowledgeBinding `json:"knowledge_binding,omitempty"`
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

type RunStatusUpdate struct {
	Status        RunStatus
	OutputDraft   *string
	BlockReason   *string
	SentMessageID *string
	CompletedAt   *time.Time
}

func mapRuleToView(rule AgentRule) RuleView {
	view := RuleView{
		ID:                      rule.ID,
		AccountID:               rule.AccountID,
		Name:                    rule.Name,
		Enabled:                 rule.Enabled,
		ScopeFilter:             rule.ScopeFilter,
		TriggerFilter:           rule.TriggerFilter,
		ReplyMode:               rule.ReplyMode,
		CooldownSeconds:         rule.CooldownSeconds,
		MaxAutoRepliesPerThread: rule.MaxAutoRepliesPerThread,
		BlacklistFilter:         rule.BlacklistFilter,
		PromptTemplate:          rule.PromptTemplate,
		KnowledgeBinding:        rule.KnowledgeBinding,
		CreatedAt:               rule.CreatedAt,
		UpdatedAt:               rule.UpdatedAt,
	}

	if view.ScopeFilter.ChatIDs == nil {
		view.ScopeFilter.ChatIDs = make([]string, 0)
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
	if view.KnowledgeBinding != nil && view.KnowledgeBinding.References == nil {
		view.KnowledgeBinding.References = make([]string, 0)
	}

	return view
}
