package agents

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"whatsapp-agent-platform/internal/audit"
	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service       *Service
	automation    *Automation
	cloudProxy    *CloudProxy
	auditRecorder interface {
		Record(ctx context.Context, input audit.RecordInput) error
	}
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("agent handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) SetAutomation(automation *Automation) {
	h.automation = automation
}

func (h *Handler) SetCloudProxy(proxy *CloudProxy) {
	h.cloudProxy = proxy
}

func (h *Handler) SetAuditRecorder(recorder interface {
	Record(ctx context.Context, input audit.RecordInput) error
}) {
	h.auditRecorder = recorder
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/agents/settings", h.handleSettings)
	mux.HandleFunc("/api/agents/rules", h.handleRules)
	mux.HandleFunc("/api/agents/rules/", h.handleRuleByID)
	mux.HandleFunc("/api/admin/agent-configs", h.handleSystemConfigs)
	mux.HandleFunc("/api/admin/agent-configs/", h.handleSystemConfigByID)
	mux.HandleFunc("/api/admin/agent-skills", h.handleSkills)
	mux.HandleFunc("/api/admin/agent-skills/", h.handleSkillByID)
	mux.HandleFunc("/api/agent-configs", h.handleAvailableSystemConfigs)
	mux.HandleFunc("/api/agent-runs", h.handleRuns)
	mux.HandleFunc("/api/agent-runs/generate", h.handleGenerateRun)
	mux.HandleFunc("/api/agent-runs/generate/stream", h.handleGenerateRunStream)
	mux.HandleFunc("/api/agent-translations", h.handleTranslateText)
	mux.HandleFunc("/api/agent-status-card", h.handleStatusCard)
	mux.HandleFunc("/api/assistant-usage-logs", h.handleUsageLogs)
	mux.HandleFunc("/api/admin/assistant-usage-log-filters", h.handleAdminUsageLogFilters)
	mux.HandleFunc("/api/admin/assistant-usage-logs", h.handleAdminUsageLogs)
	mux.HandleFunc("/api/desktop/agent-runs/generate", h.handleDesktopGenerateDraft)
	mux.HandleFunc("/api/desktop/agent-runs/generate/stream", h.handleDesktopGenerateDraftStream)
	mux.HandleFunc("/api/desktop/agent-translations", h.handleDesktopTranslateText)
	mux.HandleFunc("/api/desktop/agent-status-card", h.handleDesktopStatusCard)
	mux.HandleFunc("/api/agent-runs/", h.handleRunByID)
}

func (h *Handler) handleSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		accountID := strings.TrimSpace(r.URL.Query().Get("account_id"))
		settings, err := h.service.GetSettings(r.Context(), accountID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"settings": settings})
	case http.MethodPost:
		if _, err := auth.RequireAdmin(r.Context()); err != nil {
			h.writeServiceError(w, err)
			return
		}
		var input UpsertSettingsInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		settings, err := h.service.UpsertSettings(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		h.recordAudit(r.Context(), r, audit.RecordInput{
			ActorType:  audit.ActorTypeUser,
			ActorID:    audit.RequestActorID(r),
			Action:     "agent.settings.upsert",
			TargetType: "agent_settings",
			TargetID:   settings.AccountID,
			Outcome:    audit.OutcomeSuccess,
			Detail: map[string]any{
				"provider": settings.Provider,
				"model":    settings.Model,
			},
		})

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"settings": settings})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleRules(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		filters, err := parseRuleFilters(r)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		items, err := h.service.ListRules(r.Context(), filters)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"rules": items})
	case http.MethodPost:
		if _, err := auth.RequireAdmin(r.Context()); err != nil {
			h.writeServiceError(w, err)
			return
		}
		var input UpsertRuleInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		rule, err := h.service.UpsertRule(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		status := http.StatusOK
		if strings.TrimSpace(input.ID) == "" {
			status = http.StatusCreated
		}
		h.recordAudit(r.Context(), r, audit.RecordInput{
			ActorType:  audit.ActorTypeUser,
			ActorID:    audit.RequestActorID(r),
			Action:     "agent.rule.upsert",
			TargetType: "agent_rule",
			TargetID:   rule.ID,
			Outcome:    audit.OutcomeSuccess,
			Detail: map[string]any{
				"reply_mode": rule.ReplyMode,
				"enabled":    rule.Enabled,
			},
		})

		httpx.WriteJSON(w, status, map[string]any{"rule": rule})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleRuleByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/agents/rules/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	ruleID := parts[0]
	if len(parts) == 1 && r.Method == http.MethodGet {
		rule, err := h.service.GetRule(r.Context(), ruleID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"rule": rule})
		return
	}
	if len(parts) == 1 && r.Method == http.MethodDelete {
		if _, err := auth.RequireAdmin(r.Context()); err != nil {
			h.writeServiceError(w, err)
			return
		}
		rule, err := h.service.DeleteRule(r.Context(), ruleID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		h.recordAudit(r.Context(), r, audit.RecordInput{
			ActorType:  audit.ActorTypeUser,
			ActorID:    audit.RequestActorID(r),
			Action:     "agent.rule.delete",
			TargetType: "agent_rule",
			TargetID:   rule.ID,
			Outcome:    audit.OutcomeSuccess,
			Detail: map[string]any{
				"account_id": rule.AccountID,
				"name":       rule.Name,
			},
		})

		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(parts) != 2 || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	if _, err := auth.RequireAdmin(r.Context()); err != nil {
		h.writeServiceError(w, err)
		return
	}

	var enabled bool
	switch parts[1] {
	case "enable":
		enabled = true
	case "disable":
		enabled = false
	default:
		http.NotFound(w, r)
		return
	}

	rule, err := h.service.SetRuleEnabled(r.Context(), ruleID, enabled)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	action := "agent.rule.disable"
	if enabled {
		action = "agent.rule.enable"
	}
	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     action,
		TargetType: "agent_rule",
		TargetID:   rule.ID,
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"enabled":    rule.Enabled,
			"reply_mode": rule.ReplyMode,
		},
	})

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rule": rule})
}

func (h *Handler) handleSystemConfigs(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminSystemConfigs(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := h.service.ListSystemConfigs(r.Context())
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"configs": items})
	case http.MethodPost:
		var input UpsertSystemConfigInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		config, err := h.service.UpsertSystemConfig(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"config": config})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleSystemConfigByID(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminSystemConfigs(w, r)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/admin/agent-configs/")
	id := strings.Trim(path, "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}
	if r.Method != http.MethodDelete {
		httpx.WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}

	if err := h.service.DeleteSystemConfig(r.Context(), id); err != nil {
		h.writeServiceError(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) handleSkills(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminSkills(w, r)
		return
	}

	switch r.Method {
	case http.MethodGet:
		items, err := h.service.ListSkills(r.Context())
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"skills": items})
	case http.MethodPost:
		var input UpsertSkillInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		item, err := h.service.UpsertSkill(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"skill": item})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleSkillByID(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminSkills(w, r)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/admin/agent-skills/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	skillID := strings.TrimSpace(parts[0])
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			item, err := h.service.GetSkill(r.Context(), skillID)
			if err != nil {
				h.writeServiceError(w, err)
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"skill": item})
		case http.MethodDelete:
			if err := h.service.DeleteSkill(r.Context(), skillID); err != nil {
				h.writeServiceError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodDelete)
		}
		return
	}

	if parts[1] != "files" {
		http.NotFound(w, r)
		return
	}
	if len(parts) == 2 && r.Method == http.MethodPost {
		var input UpsertSkillFileInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		item, err := h.service.UpsertSkillFile(r.Context(), skillID, input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"skill": item})
		return
	}
	if len(parts) == 3 && r.Method == http.MethodDelete {
		item, err := h.service.DeleteSkillFile(r.Context(), skillID, parts[2])
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"skill": item})
		return
	}

	http.NotFound(w, r)
}

func (h *Handler) handleAvailableSystemConfigs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAvailableSystemConfigs(w, r)
		return
	}

	items, err := h.service.ListAvailableSystemConfigs(
		r.Context(),
		AgentPurpose(strings.TrimSpace(r.URL.Query().Get("purpose"))),
	)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"configs": items})
}

func (h *Handler) handleUsageLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleCreateUsageLog(w, r)
		return
	}

	var input CreateAssistantUsageLogInput
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	log, err := h.service.CreateUsageLog(r.Context(), input)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"log": log})
}

func (h *Handler) handleAdminUsageLogs(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminUsageLogs(w, r)
		return
	}
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	filters, err := parseUsageLogFilters(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.ListUsageLogs(r.Context(), filters)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleAdminUsageLogFilters(w http.ResponseWriter, r *http.Request) {
	if h.cloudProxy != nil {
		h.cloudProxy.HandleAdminUsageLogFilters(w, r)
		return
	}
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	options, err := h.service.ListUsageLogFilterOptions(r.Context())
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, options)
}

func (h *Handler) handleRuns(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	filters, err := parseRunFilters(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.ListRuns(r.Context(), filters)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleGenerateRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleGenerateRun(w, r)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload struct {
		ChatID              string  `json:"chat_id"`
		AgentID             string  `json:"agent_id,omitempty"`
		RuleID              string  `json:"rule_id,omitempty"`
		MessageText         *string `json:"message_text,omitempty"`
		ContextEnabled      *bool   `json:"context_enabled,omitempty"`
		ContextMessageLimit int     `json:"context_message_limit,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	run, err := h.automation.GenerateRun(r.Context(), GenerateRunInput{
		ChatID:              payload.ChatID,
		AgentID:             payload.AgentID,
		RuleID:              payload.RuleID,
		MessageText:         payload.MessageText,
		ContextEnabled:      optionalBoolValue(payload.ContextEnabled, true),
		ContextMessageLimit: payload.ContextMessageLimit,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     "agent.run.generate",
		TargetType: "agent_run",
		TargetID:   run.ID,
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"chat_id":    run.ChatID,
			"account_id": run.AccountID,
			"rule_id":    run.RuleID,
			"status":     run.Status,
		},
	})

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"run": run})
}

func (h *Handler) handleTranslateText(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleTranslateText(w, r)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload struct {
		AccountID          string `json:"account_id"`
		AgentID            string `json:"agent_id,omitempty"`
		Text               string `json:"text"`
		TargetLanguage     string `json:"target_language"`
		TargetLanguageName string `json:"target_language_name,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	translation, err := h.automation.TranslateText(r.Context(), TranslateTextInput{
		AccountID:          payload.AccountID,
		AgentID:            payload.AgentID,
		Text:               payload.Text,
		TargetLanguage:     payload.TargetLanguage,
		TargetLanguageName: payload.TargetLanguageName,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"translation": translation})
}

func (h *Handler) handleStatusCard(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.handleGetStatusCard(w, r)
	case http.MethodPost:
		h.handleAnalyzeStatusCard(w, r)
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleGetStatusCard(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.URL.Query().Get("chat_id"))
	statusCard, err := h.service.GetStatusCard(r.Context(), chatID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"status_card": nil})
			return
		}
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"status_card": statusCard})
}

func (h *Handler) handleAnalyzeStatusCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleStatusCard(w, r)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload struct {
		ChatID              string `json:"chat_id"`
		AgentID             string `json:"agent_id,omitempty"`
		ContextMessageLimit int    `json:"context_message_limit,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	statusCard, err := h.automation.AnalyzeStatusCard(r.Context(), AnalyzeStatusCardInput{
		ChatID:              payload.ChatID,
		AgentID:             payload.AgentID,
		ContextMessageLimit: payload.ContextMessageLimit,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     "agent.status_card.analyze",
		TargetType: "chat",
		TargetID:   payload.ChatID,
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"agent_id":      statusCard.AgentID,
			"agent_name":    statusCard.AgentName,
			"message_count": statusCard.MessageCount,
			"history_limit": statusCard.HistoryLimit,
		},
	})

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"status_card": statusCard})
}

func (h *Handler) handleGenerateRunStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.cloudProxy != nil {
		h.cloudProxy.HandleGenerateRunStream(w, r)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload struct {
		ChatID              string  `json:"chat_id"`
		AgentID             string  `json:"agent_id,omitempty"`
		RuleID              string  `json:"rule_id,omitempty"`
		MessageText         *string `json:"message_text,omitempty"`
		ContextEnabled      *bool   `json:"context_enabled,omitempty"`
		ContextMessageLimit int     `json:"context_message_limit,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	finalRun, err := h.automation.GenerateRunStream(
		r.Context(),
		GenerateRunInput{
			ChatID:              payload.ChatID,
			AgentID:             payload.AgentID,
			RuleID:              payload.RuleID,
			MessageText:         payload.MessageText,
			ContextEnabled:      optionalBoolValue(payload.ContextEnabled, true),
			ContextMessageLimit: payload.ContextMessageLimit,
		},
		GenerateRunStreamCallbacks{
			OnStart: func(run RunView) error {
				return writeAgentRunSSE(w, "start", map[string]any{"run": run})
			},
			OnDelta: func(text string) error {
				return writeAgentRunSSE(w, "delta", map[string]any{"text": text})
			},
		},
	)
	if err != nil {
		errorPayload := map[string]any{"message": err.Error()}
		if strings.TrimSpace(finalRun.ID) != "" {
			errorPayload["run"] = finalRun
		}
		_ = writeAgentRunSSE(w, "error", errorPayload)
		return
	}

	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     "agent.run.generate.stream",
		TargetType: "agent_run",
		TargetID:   finalRun.ID,
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"chat_id":    finalRun.ChatID,
			"account_id": finalRun.AccountID,
			"rule_id":    finalRun.RuleID,
			"status":     finalRun.Status,
		},
	})

	_ = writeAgentRunSSE(w, "complete", map[string]any{"run": finalRun})
}

func (h *Handler) handleRunByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/agent-runs/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 {
		http.NotFound(w, r)
		return
	}

	runID := strings.TrimSpace(parts[0])
	if runID == "" {
		http.NotFound(w, r)
		return
	}

	if parts[1] != "send" || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}

	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload struct {
		MessageText *string `json:"message_text,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil && !errors.Is(err, io.EOF) {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	updated, err := h.automation.SendRun(r.Context(), runID, SendRunInput{MessageText: payload.MessageText})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     "agent.run.send",
		TargetType: "agent_run",
		TargetID:   runID,
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"chat_id":    updated.ChatID,
			"account_id": updated.AccountID,
		},
	})

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"run": updated})
}

func (h *Handler) handleDesktopGenerateDraft(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload DesktopAgentDraftInput
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.automation.GenerateDesktopDraft(r.Context(), payload)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"result": result})
}

func (h *Handler) handleDesktopGenerateDraftStream(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload DesktopAgentDraftInput
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	result, err := h.automation.GenerateDesktopDraftStream(
		r.Context(),
		payload,
		GenerateRunStreamCallbacks{
			OnDelta: func(text string) error {
				return writeAgentRunSSE(w, "delta", map[string]any{"text": text})
			},
		},
	)
	if err != nil {
		_ = writeAgentRunSSE(w, "error", map[string]any{"message": err.Error()})
		return
	}

	_ = writeAgentRunSSE(w, "complete", map[string]any{"result": result})
}

func (h *Handler) handleDesktopTranslateText(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload DesktopAgentTranslationInput
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	translation, err := h.automation.TranslateDesktopText(r.Context(), payload)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"translation": translation})
}

func (h *Handler) handleDesktopStatusCard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}
	if h.automation == nil {
		httpx.WriteError(w, http.StatusNotImplemented, "agent automation is not configured")
		return
	}

	var payload DesktopAgentStatusCardInput
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	statusCard, err := h.automation.AnalyzeDesktopStatusCard(r.Context(), payload)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"status_card": statusCard})
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, auth.ErrUnauthenticated):
		httpx.WriteError(w, http.StatusUnauthorized, err.Error())
	case errors.Is(err, auth.ErrForbidden):
		httpx.WriteError(w, http.StatusForbidden, err.Error())
	case errors.Is(err, ErrRuleNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrSettingsNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrAccountNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}

func (h *Handler) recordAudit(ctx context.Context, r *http.Request, input audit.RecordInput) {
	if h.auditRecorder == nil {
		return
	}

	_ = h.auditRecorder.Record(ctx, input)
}

func writeAgentRunSSE(w http.ResponseWriter, event string, payload any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, body); err != nil {
		return err
	}
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	return nil
}

func optionalBoolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func parseRuleFilters(r *http.Request) (RuleListFilters, error) {
	filters := RuleListFilters{
		AccountID: strings.TrimSpace(r.URL.Query().Get("account_id")),
	}

	if rawEnabled := strings.TrimSpace(r.URL.Query().Get("enabled")); rawEnabled != "" {
		enabled, err := strconv.ParseBool(rawEnabled)
		if err != nil {
			return RuleListFilters{}, fmt.Errorf("enabled must be true or false")
		}
		filters.Enabled = &enabled
	}

	return filters, nil
}

func parseRunFilters(r *http.Request) (RunListFilters, error) {
	limit := 12
	offset := 0
	var err error

	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		limit, err = strconv.Atoi(rawLimit)
		if err != nil {
			return RunListFilters{}, fmt.Errorf("limit must be a number")
		}
	}
	if rawOffset := strings.TrimSpace(r.URL.Query().Get("offset")); rawOffset != "" {
		offset, err = strconv.Atoi(rawOffset)
		if err != nil {
			return RunListFilters{}, fmt.Errorf("offset must be a number")
		}
	}

	return RunListFilters{
		AccountID: strings.TrimSpace(r.URL.Query().Get("account_id")),
		RuleID:    strings.TrimSpace(r.URL.Query().Get("rule_id")),
		ChatID:    strings.TrimSpace(r.URL.Query().Get("chat_id")),
		Status:    RunStatus(strings.TrimSpace(r.URL.Query().Get("status"))),
		Limit:     limit,
		Offset:    offset,
	}, nil
}

func parseUsageLogFilters(r *http.Request) (AssistantUsageLogFilters, error) {
	limit := 50
	offset := 0
	var err error

	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		limit, err = strconv.Atoi(rawLimit)
		if err != nil {
			return AssistantUsageLogFilters{}, fmt.Errorf("limit must be a number")
		}
	}
	if rawOffset := strings.TrimSpace(r.URL.Query().Get("offset")); rawOffset != "" {
		offset, err = strconv.Atoi(rawOffset)
		if err != nil {
			return AssistantUsageLogFilters{}, fmt.Errorf("offset must be a number")
		}
	}

	return AssistantUsageLogFilters{
		LogDate:   strings.TrimSpace(r.URL.Query().Get("log_date")),
		UserID:    strings.TrimSpace(r.URL.Query().Get("user_id")),
		AccountID: strings.TrimSpace(r.URL.Query().Get("account_id")),
		ChatID:    strings.TrimSpace(r.URL.Query().Get("chat_id")),
		AgentID:   strings.TrimSpace(r.URL.Query().Get("agent_id")),
		Action:    AssistantUsageAction(strings.TrimSpace(r.URL.Query().Get("action"))),
		Limit:     limit,
		Offset:    offset,
	}, nil
}
