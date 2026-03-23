package exports

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/support/ids"
)

var ErrExportJobNotFound = errors.New("export job not found")

type ScopeType string

const ScopeTypeChat ScopeType = "chat"

type Format string

const (
	FormatJSON     Format = "json"
	FormatMarkdown Format = "markdown"
	FormatHTML     Format = "html"
)

type Status string

const (
	StatusQueued    Status = "queued"
	StatusRunning   Status = "running"
	StatusCompleted Status = "completed"
	StatusFailed    Status = "failed"
)

type ExportJob struct {
	ID           string
	AccountID    string
	ChatID       string
	ScopeType    ScopeType
	Format       Format
	IncludeMedia bool
	Status       Status
	ArtifactPath *string
	ErrorMessage *string
	CreatedAt    time.Time
	StartedAt    *time.Time
	CompletedAt  *time.Time
}

type ExportDocument struct {
	JobID        string              `json:"job_id"`
	GeneratedAt  time.Time           `json:"generated_at"`
	ChatTitle    string              `json:"chat_title"`
	Chat         chats.ChatHeader    `json:"chat"`
	Messages     []chats.MessageView `json:"messages"`
	IncludeMedia bool                `json:"include_media"`
}

type CreateJobInput struct {
	ChatID       string `json:"chat_id"`
	Format       Format `json:"format"`
	IncludeMedia bool   `json:"include_media"`
}

type JobView struct {
	ID           string     `json:"id"`
	AccountID    string     `json:"account_id"`
	ChatID       string     `json:"chat_id"`
	ScopeType    ScopeType  `json:"scope_type"`
	Format       Format     `json:"format"`
	IncludeMedia bool       `json:"include_media"`
	Status       Status     `json:"status"`
	ArtifactPath *string    `json:"artifact_path,omitempty"`
	ErrorMessage *string    `json:"error_message,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	StartedAt    *time.Time `json:"started_at,omitempty"`
	CompletedAt  *time.Time `json:"completed_at,omitempty"`
}

type Service struct {
	repository     *Repository
	chatRepository *chats.Repository
	outputDir      string
	logger         *slog.Logger
}

func NewService(
	repository *Repository,
	chatRepository *chats.Repository,
	outputDir string,
	logger *slog.Logger,
) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("export service requires a repository")
	}
	if chatRepository == nil {
		return nil, fmt.Errorf("export service requires a chat repository")
	}
	if strings.TrimSpace(outputDir) == "" {
		outputDir = "data/exports"
	}
	if logger == nil {
		logger = slog.Default()
	}

	return &Service{
		repository:     repository,
		chatRepository: chatRepository,
		outputDir:      outputDir,
		logger:         logger.With("component", "export_service"),
	}, nil
}

func (s *Service) CreateJob(ctx context.Context, input CreateJobInput) (JobView, error) {
	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return JobView{}, fmt.Errorf("chat_id is required")
	}

	format := normalizeFormat(input.Format)
	if format == "" {
		return JobView{}, fmt.Errorf("unsupported export format %q", input.Format)
	}

	header, err := s.chatRepository.GetChatHeader(ctx, chatID)
	if err != nil {
		return JobView{}, mapChatLookupError(chatID, err)
	}

	job := ExportJob{
		ID:           ids.NewUUID(),
		AccountID:    header.AccountID,
		ChatID:       header.ID,
		ScopeType:    ScopeTypeChat,
		Format:       format,
		IncludeMedia: input.IncludeMedia,
		Status:       StatusQueued,
		CreatedAt:    time.Now().UTC(),
	}

	if err := s.repository.Create(ctx, job); err != nil {
		return JobView{}, err
	}

	go s.processJob(job.ID)

	return mapJobToView(job), nil
}

func (s *Service) ListJobs(ctx context.Context) ([]JobView, error) {
	items, err := s.repository.List(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]JobView, 0, len(items))
	for _, item := range items {
		result = append(result, mapJobToView(item))
	}

	return result, nil
}

func (s *Service) GetJob(ctx context.Context, jobID string) (JobView, error) {
	job, err := s.repository.GetByID(ctx, strings.TrimSpace(jobID))
	if err != nil {
		return JobView{}, mapRepositoryError(jobID, err)
	}

	return mapJobToView(job), nil
}

func (s *Service) ArtifactFilePath(ctx context.Context, jobID string) (string, error) {
	job, err := s.repository.GetByID(ctx, strings.TrimSpace(jobID))
	if err != nil {
		return "", mapRepositoryError(jobID, err)
	}
	if job.ArtifactPath == nil || *job.ArtifactPath == "" {
		return "", fmt.Errorf("artifact is not available")
	}

	return *job.ArtifactPath, nil
}

func (s *Service) processJob(jobID string) {
	ctx := context.Background()
	startedAt := time.Now().UTC()

	if err := s.repository.MarkRunning(ctx, jobID, startedAt); err != nil {
		s.logger.Error("failed to mark export job running", "job_id", jobID, "error", err)
		return
	}

	job, err := s.repository.GetByID(ctx, jobID)
	if err != nil {
		s.logger.Error("failed to reload export job", "job_id", jobID, "error", err)
		return
	}

	document, err := s.buildDocument(ctx, job)
	if err != nil {
		s.failJob(ctx, job.ID, err)
		return
	}

	body, extension, err := s.render(document, job.Format)
	if err != nil {
		s.failJob(ctx, job.ID, err)
		return
	}

	if err := os.MkdirAll(s.outputDir, 0o755); err != nil {
		s.failJob(ctx, job.ID, fmt.Errorf("create export output dir: %w", err))
		return
	}

	filePath := filepath.Join(s.outputDir, fmt.Sprintf("%s.%s", job.ID, extension))
	if err := os.WriteFile(filePath, body, 0o644); err != nil {
		s.failJob(ctx, job.ID, fmt.Errorf("write export artifact: %w", err))
		return
	}

	if err := s.repository.MarkCompleted(ctx, job.ID, filePath, time.Now().UTC()); err != nil {
		s.logger.Error("failed to mark export job completed", "job_id", job.ID, "error", err)
		return
	}

	s.logger.Info("export job completed", "job_id", job.ID, "format", job.Format, "artifact_path", filePath)
}

func (s *Service) buildDocument(ctx context.Context, job ExportJob) (ExportDocument, error) {
	header, err := s.chatRepository.GetChatHeader(ctx, job.ChatID)
	if err != nil {
		return ExportDocument{}, err
	}

	pages := make([][]chats.MessageView, 0)
	var before *time.Time

	for {
		chunk, hasMore, err := s.chatRepository.ListMessages(ctx, chats.MessageListFilters{
			ChatID: job.ChatID,
			Limit:  200,
			Before: before,
		})
		if err != nil {
			return ExportDocument{}, err
		}

		pages = append(pages, chunk)
		if !hasMore || len(chunk) == 0 {
			break
		}

		cursor := chunk[0].SentAt
		before = &cursor
	}

	messages := make([]chats.MessageView, 0)
	for index := len(pages) - 1; index >= 0; index-- {
		messages = append(messages, pages[index]...)
	}

	chatTitle := header.WAChatJID
	if header.Title != nil && strings.TrimSpace(*header.Title) != "" {
		chatTitle = *header.Title
	}

	if !job.IncludeMedia {
		for index := range messages {
			messages[index].Media = []chats.MediaAttachment{}
		}
	}

	return ExportDocument{
		JobID:        job.ID,
		GeneratedAt:  time.Now().UTC(),
		ChatTitle:    chatTitle,
		Chat:         header,
		Messages:     messages,
		IncludeMedia: job.IncludeMedia,
	}, nil
}

func (s *Service) render(document ExportDocument, format Format) ([]byte, string, error) {
	switch format {
	case FormatJSON:
		body, err := RenderJSON(document)
		return body, "json", err
	case FormatMarkdown:
		body, err := RenderMarkdown(document)
		return body, "md", err
	case FormatHTML:
		body, err := RenderHTML(document)
		return body, "html", err
	default:
		return nil, "", fmt.Errorf("unsupported export format %q", format)
	}
}

func (s *Service) failJob(ctx context.Context, jobID string, err error) {
	s.logger.Error("export job failed", "job_id", jobID, "error", err)
	if markErr := s.repository.MarkFailed(ctx, jobID, err.Error(), time.Now().UTC()); markErr != nil {
		s.logger.Error("failed to persist export job failure", "job_id", jobID, "error", markErr)
	}
}

func mapJobToView(job ExportJob) JobView {
	return JobView{
		ID:           job.ID,
		AccountID:    job.AccountID,
		ChatID:       job.ChatID,
		ScopeType:    job.ScopeType,
		Format:       job.Format,
		IncludeMedia: job.IncludeMedia,
		Status:       job.Status,
		ArtifactPath: job.ArtifactPath,
		ErrorMessage: job.ErrorMessage,
		CreatedAt:    job.CreatedAt,
		StartedAt:    job.StartedAt,
		CompletedAt:  job.CompletedAt,
	}
}

func normalizeFormat(value Format) Format {
	switch strings.ToLower(strings.TrimSpace(string(value))) {
	case string(FormatJSON):
		return FormatJSON
	case string(FormatMarkdown):
		return FormatMarkdown
	case string(FormatHTML):
		return FormatHTML
	default:
		return ""
	}
}

func fallbackExportText(messageType string) string {
	switch messageType {
	case "image":
		return "Image message"
	case "video":
		return "Video message"
	case "audio":
		return "Audio message"
	case "document":
		return "Document message"
	case "sticker":
		return "Sticker message"
	case "reaction":
		return "Reaction"
	case "system":
		return "System message"
	default:
		return "No text content available"
	}
}

func mediaLabel(fileName *string, storageKey *string) string {
	if fileName != nil && strings.TrimSpace(*fileName) != "" {
		return *fileName
	}
	if storageKey != nil && strings.TrimSpace(*storageKey) != "" {
		return *storageKey
	}

	return "unnamed-media"
}

func mapRepositoryError(targetID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("%w: %s", ErrExportJobNotFound, targetID)
	}

	return err
}

func mapChatLookupError(chatID string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("chat not found: %s", chatID)
	}

	return err
}
