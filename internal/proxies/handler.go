package proxies

import (
	"errors"
	"net/http"
	"strings"

	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/proxies", h.handleCollection)
	mux.HandleFunc("/api/proxies/", h.handleItem)
}

func (h *Handler) handleCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := h.service.List(r.Context())
		if err != nil {
			h.writeError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"proxies": items})
	case http.MethodPost:
		var input Input
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		item, err := h.service.Create(r.Context(), input)
		if err != nil {
			h.writeError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"proxy": item})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleItem(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/proxies/"), "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}
	id := parts[0]
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodPatch:
			var input UpdateInput
			if err := httpx.DecodeJSON(r, &input); err != nil {
				httpx.WriteError(w, http.StatusBadRequest, err.Error())
				return
			}
			item, err := h.service.Update(r.Context(), id, input)
			if err != nil {
				h.writeError(w, err)
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"proxy": item})
		case http.MethodDelete:
			if err := h.service.Delete(r.Context(), id); err != nil {
				h.writeError(w, err)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			httpx.WriteMethodNotAllowed(w, http.MethodPatch, http.MethodDelete)
		}
		return
	}

	if len(parts) == 2 && parts[1] == "test" && r.Method == http.MethodPost {
		item, err := h.service.Test(r.Context(), id)
		if err != nil {
			h.writeError(w, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"proxy": item})
		return
	}
	http.NotFound(w, r)
}

func (h *Handler) writeError(w http.ResponseWriter, err error) {
	status := http.StatusBadRequest
	if errors.Is(err, ErrProxyNotFound) {
		status = http.StatusNotFound
	}
	httpx.WriteError(w, status, err.Error())
}
