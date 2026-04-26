package chats

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/httpx"
	"whatsapp-agent-platform/internal/ingest"
)

type Handler struct {
	service *Service
}

const maxMediaUploadBytes = 64 << 20

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
		if isMultipartRequest(r) {
			h.handleSendMediaMessage(w, r, chatID)
			return
		}

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

func (h *Handler) handleSendMediaMessage(w http.ResponseWriter, r *http.Request, chatID string) {
	r.Body = http.MaxBytesReader(w, r.Body, maxMediaUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("parse media form: %v", err))
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxMediaUploadBytes+1))
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("read media file: %v", err))
		return
	}
	if len(data) == 0 {
		httpx.WriteError(w, http.StatusBadRequest, "file is empty")
		return
	}
	if int64(len(data)) > maxMediaUploadBytes {
		httpx.WriteError(w, http.StatusBadRequest, "file is too large")
		return
	}

	mimeType := strings.TrimSpace(r.FormValue("mime_type"))
	if mimeType == "" && header != nil {
		mimeType = strings.TrimSpace(header.Header.Get("Content-Type"))
	}
	if mimeType == "" {
		mimeType = http.DetectContentType(data)
	}

	fileName := ""
	if header != nil {
		if trimmed := strings.TrimSpace(header.Filename); trimmed != "" {
			fileName = filepath.Base(trimmed)
		}
	}

	result, err := h.service.SendMedia(r.Context(), SendMediaInput{
		ChatID:    chatID,
		MediaType: inferRequestedMediaType(r.FormValue("media_type"), mimeType, fileName),
		FileName:  fileName,
		MIMEType:  mimeType,
		Caption:   r.FormValue("caption"),
		Data:      data,
	})
	if err != nil {
		h.writeServiceError(w, err)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, result)
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

func isMultipartRequest(r *http.Request) bool {
	contentType := strings.ToLower(strings.TrimSpace(r.Header.Get("Content-Type")))
	return strings.HasPrefix(contentType, "multipart/form-data")
}

func inferRequestedMediaType(raw, mimeType, fileName string) ingest.MediaType {
	switch ingest.MediaType(strings.ToLower(strings.TrimSpace(raw))) {
	case ingest.MediaTypeImage, ingest.MediaTypeVideo, ingest.MediaTypeAudio, ingest.MediaTypeDocument:
		return ingest.MediaType(strings.ToLower(strings.TrimSpace(raw)))
	}

	lowerMIME := strings.ToLower(strings.TrimSpace(mimeType))
	switch {
	case strings.HasPrefix(lowerMIME, "image/"):
		return ingest.MediaTypeImage
	case strings.HasPrefix(lowerMIME, "video/"):
		return ingest.MediaTypeVideo
	case strings.HasPrefix(lowerMIME, "audio/"):
		return ingest.MediaTypeAudio
	}

	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif":
		return ingest.MediaTypeImage
	case ".mp4", ".mov", ".m4v", ".webm", ".mkv":
		return ingest.MediaTypeVideo
	case ".mp3", ".m4a", ".ogg", ".opus", ".wav", ".aac":
		return ingest.MediaTypeAudio
	default:
		return ingest.MediaTypeDocument
	}
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
