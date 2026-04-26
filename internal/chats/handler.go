package chats

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/httpx"
	"whatsapp-agent-platform/internal/ingest"
)

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("chat handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/chats", h.handleChats)
	mux.HandleFunc("/api/chats/", h.handleChatByID)
	mux.HandleFunc("/api/media/", h.handleMediaByID)
}

func (h *Handler) handleChats(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	limit, err := parseIntQuery(r, "limit", 24)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	offset, err := parseIntQuery(r, "offset", 0)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := h.service.ListChats(r.Context(), ListChatsInput{
		AccountID: r.URL.Query().Get("account_id"),
		Query:     r.URL.Query().Get("query"),
		ChatType:  ingest.ChatType(r.URL.Query().Get("chat_type")),
		Limit:     limit,
		Offset:    offset,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
}

func (h *Handler) handleChatByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/chats/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) < 2 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	chatID := parts[0]
	action := parts[1]

	switch {
	case r.Method == http.MethodGet && action == "messages":
		limit, err := parseIntQuery(r, "limit", 50)
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		before, err := parseTimeQuery(r, "before")
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		result, err := h.service.GetMessages(r.Context(), GetMessagesInput{
			ChatID: chatID,
			Limit:  limit,
			Before: before,
		})
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, result)
	case r.Method == http.MethodPost && action == "messages":
		var input SendMessageInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		input.ChatID = chatID

		result, err := h.service.SendMessage(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, result)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) handleMediaByID(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		httpx.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/api/media/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || parts[1] != "content" {
		http.NotFound(w, r)
		return
	}

	filePath, mimeType, err := h.service.GetMediaContentPath(r.Context(), parts[0])
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	if mimeType != nil && strings.TrimSpace(*mimeType) != "" {
		w.Header().Set("Content-Type", *mimeType)
	}
	if _, statErr := os.Stat(filePath); statErr != nil {
		httpx.WriteError(w, http.StatusNotFound, statErr.Error())
		return
	}

	http.ServeFile(w, r, filePath)
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrChatNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}

func parseIntQuery(r *http.Request, key string, fallback int) (int, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback, nil
	}

	value, err := strconv.Atoi(raw)
	if err != nil {
		return 0, fmt.Errorf("%s must be an integer", key)
	}
	if value < 0 {
		return 0, fmt.Errorf("%s must be zero or greater", key)
	}

	return value, nil
}

func parseTimeQuery(r *http.Request, key string) (*time.Time, error) {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return nil, nil
	}

	value, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, fmt.Errorf("%s must use RFC3339 format", key)
	}

	return &value, nil
}
