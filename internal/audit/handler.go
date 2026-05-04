package audit

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("audit handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/audit", h.handleAuditLogs)
}

func (h *Handler) handleAuditLogs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}
	if _, err := auth.RequireAdmin(r.Context()); err != nil {
		if errors.Is(err, auth.ErrUnauthenticated) {
			httpx.WriteError(w, http.StatusUnauthorized, err.Error())
			return
		}
		httpx.WriteError(w, http.StatusForbidden, err.Error())
		return
	}

	filters, err := parseFilters(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.List(r.Context(), filters)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func parseFilters(r *http.Request) (ListFilters, error) {
	limit := 25
	offset := 0
	var err error

	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		limit, err = strconv.Atoi(rawLimit)
		if err != nil {
			return ListFilters{}, fmt.Errorf("limit must be a number")
		}
	}
	if rawOffset := strings.TrimSpace(r.URL.Query().Get("offset")); rawOffset != "" {
		offset, err = strconv.Atoi(rawOffset)
		if err != nil {
			return ListFilters{}, fmt.Errorf("offset must be a number")
		}
	}

	return ListFilters{
		Action:     strings.TrimSpace(r.URL.Query().Get("action")),
		TargetType: strings.TrimSpace(r.URL.Query().Get("target_type")),
		TargetID:   strings.TrimSpace(r.URL.Query().Get("target_id")),
		Outcome:    Outcome(strings.TrimSpace(r.URL.Query().Get("outcome"))),
		ActorType:  ActorType(strings.TrimSpace(r.URL.Query().Get("actor_type"))),
		Limit:      limit,
		Offset:     offset,
	}, nil
}
