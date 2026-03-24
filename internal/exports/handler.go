package exports

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"whatsapp-agent-platform/internal/audit"
	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service       *Service
	auditRecorder interface {
		Record(ctx context.Context, input audit.RecordInput) error
	}
}

func NewHandler(service *Service) (*Handler, error) {
	if service == nil {
		return nil, fmt.Errorf("export handler requires a service")
	}

	return &Handler{service: service}, nil
}

func (h *Handler) SetAuditRecorder(recorder interface {
	Record(ctx context.Context, input audit.RecordInput) error
}) {
	h.auditRecorder = recorder
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/exports", h.handleExports)
	mux.HandleFunc("/api/exports/", h.handleExportByID)
}

func (h *Handler) handleExports(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := h.service.ListJobs(r.Context())
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"jobs": items})
	case http.MethodPost:
		var input CreateJobInput
		if err := httpx.DecodeJSON(r, &input); err != nil {
			httpx.WriteError(w, http.StatusBadRequest, err.Error())
			return
		}

		job, err := h.service.CreateJob(r.Context(), input)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.recordAudit(r.Context(), r, audit.RecordInput{
			ActorType:  audit.ActorTypeUser,
			ActorID:    audit.RequestActorID(r),
			Action:     "export.job.create",
			TargetType: "export_job",
			TargetID:   job.ID,
			Outcome:    audit.OutcomeSuccess,
			Detail: map[string]any{
				"chat_id":       job.ChatID,
				"format":        job.Format,
				"include_media": job.IncludeMedia,
			},
		})

		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"job": job})
	default:
		httpx.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h *Handler) recordAudit(ctx context.Context, r *http.Request, input audit.RecordInput) {
	if h.auditRecorder == nil {
		return
	}

	_ = h.auditRecorder.Record(ctx, input)
}

func (h *Handler) handleExportByID(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/api/exports/")
	parts := strings.Split(strings.Trim(path, "/"), "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		http.NotFound(w, r)
		return
	}

	jobID := parts[0]

	switch {
	case r.Method == http.MethodGet && len(parts) == 1:
		job, err := h.service.GetJob(r.Context(), jobID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		httpx.WriteJSON(w, http.StatusOK, map[string]any{"job": job})
	case r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "artifact":
		filePath, err := h.service.ArtifactFilePath(r.Context(), jobID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}

		http.ServeFile(w, r, filePath)
	default:
		http.NotFound(w, r)
	}
}

func (h *Handler) writeServiceError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrExportJobNotFound):
		httpx.WriteError(w, http.StatusNotFound, err.Error())
	default:
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
	}
}
