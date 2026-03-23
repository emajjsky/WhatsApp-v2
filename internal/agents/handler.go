package agents

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("agent handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/agents/rules", h.handleRules)
	mux.HandleFunc("/api/agents/rules/", h.handleRuleByID)
	mux.HandleFunc("/api/agent-runs", h.handleRuns)
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
	if len(parts) != 2 || r.Method != http.MethodPost {
		http.NotFound(w, r)
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

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"rule": rule})
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

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrRuleNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrAccountNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
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
		Status:    RunStatus(strings.TrimSpace(r.URL.Query().Get("status"))),
		Limit:     limit,
		Offset:    offset,
	}, nil
}
