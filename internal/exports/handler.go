package exports

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/audit"
	"whatsapp-agent-platform/internal/httpx"
)

type Handler struct {
	service       *Service
	auditRecorder interface {
		Record(ctx context.Context, input audit.RecordInput) error
	}
}

type archiveRequest struct {
	JobIDs []string `json:"job_ids"`
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
	mux.HandleFunc("/api/exports/archive", h.handleExportArchive)
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
				"account_ids":   job.AccountIDs,
				"chat_ids":      job.ChatIDs,
				"date_from":     job.DateFrom,
				"date_to":       job.DateTo,
				"scope_type":    job.ScopeType,
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

func (h *Handler) handleExportArchive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var input archiveRequest
	if err := httpx.DecodeJSON(r, &input); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	artifacts, err := h.service.ArtifactFiles(r.Context(), input.JobIDs)
	if err != nil {
		h.writeServiceError(w, err)
		return
	}
	for _, artifact := range artifacts {
		if _, statErr := os.Stat(artifact.FilePath); statErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, statErr.Error())
			return
		}
	}

	archiveName := fmt.Sprintf("whatsapp-exports-%s.zip", time.Now().UTC().Format("20060102-150405"))
	var archiveBuffer bytes.Buffer
	zipWriter := zip.NewWriter(&archiveBuffer)
	usedNames := make(map[string]int, len(artifacts))
	for _, artifact := range artifacts {
		entryName := uniqueZipName(filepath.Base(artifact.DownloadName), artifact.JobID, usedNames)
		entryWriter, createErr := zipWriter.Create(entryName)
		if createErr != nil {
			_ = zipWriter.Close()
			httpx.WriteError(w, http.StatusInternalServerError, createErr.Error())
			return
		}

		file, openErr := os.Open(filepath.Clean(artifact.FilePath))
		if openErr != nil {
			_ = zipWriter.Close()
			httpx.WriteError(w, http.StatusInternalServerError, openErr.Error())
			return
		}

		if _, copyErr := io.Copy(entryWriter, file); copyErr != nil {
			_ = file.Close()
			_ = zipWriter.Close()
			httpx.WriteError(w, http.StatusInternalServerError, copyErr.Error())
			return
		}

		_ = file.Close()
	}

	if err := zipWriter.Close(); err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", archiveName))
	if _, err := w.Write(archiveBuffer.Bytes()); err != nil {
		return
	}

	h.recordAudit(r.Context(), r, audit.RecordInput{
		ActorType:  audit.ActorTypeUser,
		ActorID:    audit.RequestActorID(r),
		Action:     "export.job.archive",
		TargetType: "export_job",
		TargetID:   strings.Join(normalizeIDList(input.JobIDs), ","),
		Outcome:    audit.OutcomeSuccess,
		Detail: map[string]any{
			"job_ids":        normalizeIDList(input.JobIDs),
			"artifact_count": len(artifacts),
		},
	})
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
	case r.Method == http.MethodDelete && len(parts) == 1:
		job, err := h.service.DeleteJob(r.Context(), jobID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		h.recordAudit(r.Context(), r, audit.RecordInput{
			ActorType:  audit.ActorTypeUser,
			ActorID:    audit.RequestActorID(r),
			Action:     "export.job.delete",
			TargetType: "export_job",
			TargetID:   job.ID,
			Outcome:    audit.OutcomeSuccess,
			Detail: map[string]any{
				"account_ids": job.AccountIDs,
				"chat_ids":    job.ChatIDs,
				"status":      job.Status,
			},
		})

		w.WriteHeader(http.StatusNoContent)
	case r.Method == http.MethodGet && len(parts) == 2 && parts[1] == "artifact":
		filePath, err := h.service.ArtifactFilePath(r.Context(), jobID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		downloadName, err := h.service.ArtifactDownloadName(r.Context(), jobID)
		if err != nil {
			h.writeServiceError(w, err)
			return
		}
		if contentType := mime.TypeByExtension(fileExt(downloadName)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", downloadName))

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

func fileExt(name string) string {
	lastDot := strings.LastIndex(name, ".")
	if lastDot < 0 {
		return ""
	}

	return strings.ToLower(name[lastDot:])
}

func uniqueZipName(downloadName string, jobID string, usedNames map[string]int) string {
	baseName := strings.TrimSpace(downloadName)
	if baseName == "" {
		baseName = fmt.Sprintf("whatsapp-export-%s", jobID)
	}

	count := usedNames[baseName]
	usedNames[baseName] = count + 1
	if count == 0 {
		return baseName
	}

	extension := filepath.Ext(baseName)
	stem := strings.TrimSuffix(baseName, extension)
	return fmt.Sprintf("%s-%d%s", stem, count+1, extension)
}
