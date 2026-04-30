package scripts

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"whatsapp-agent-platform/internal/httpx"
)

const maxScriptUploadBytes = 100 << 20

type Handler struct {
	service *Service
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("script handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/scripts", h.handleScripts)
	mux.HandleFunc("/api/scripts/", h.handleScriptByID)
}

func (h *Handler) handleScripts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := h.service.List(r.Context())
		if err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"scripts": items})
	case http.MethodPost:
		h.handleUpload(w, r)
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) handleUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxScriptUploadBytes+(1<<20))
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("parse script upload: %v", err))
		return
	}

	title := strings.TrimSpace(r.FormValue("title"))
	content := strings.TrimSpace(r.FormValue("content"))
	fileName := "script.txt"
	contentType := "text/plain; charset=utf-8"
	data := []byte(content)

	file, header, err := r.FormFile("file")
	if err == nil {
		defer file.Close()
		payload, readErr := io.ReadAll(io.LimitReader(file, maxScriptUploadBytes+1))
		if readErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, fmt.Sprintf("read script file: %v", readErr))
			return
		}
		if int64(len(payload)) > maxScriptUploadBytes {
			httpx.WriteError(w, http.StatusBadRequest, "script file is too large")
			return
		}

		data = payload
		if header != nil {
			fileName = header.Filename
			if header.Header.Get("Content-Type") != "" {
				contentType = header.Header.Get("Content-Type")
			}
		}
	} else if content == "" {
		httpx.WriteError(w, http.StatusBadRequest, "file or content is required")
		return
	}

	item, err := h.service.Upload(r.Context(), UploadInput{
		Title:       title,
		FileName:    fileName,
		ContentType: contentType,
		Data:        data,
	})
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"script": item})
}

func (h *Handler) handleScriptByID(w http.ResponseWriter, r *http.Request) {
	id := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/scripts/"), "/")
	if id == "" {
		http.NotFound(w, r)
		return
	}

	switch r.Method {
	case http.MethodDelete:
		if err := h.service.Delete(r.Context(), id); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}
