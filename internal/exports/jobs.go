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

const (
	ScopeTypeChat      ScopeType = "chat"
	ScopeTypeChatBatch ScopeType = "chat_batch"
)

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
	AccountIDs   []string
	ChatIDs      []string
	DateFrom     *time.Time
	DateTo       *time.Time
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

type ExportSelection struct {
	AccountIDs []string   `json:"account_ids"`
	ChatIDs    []string   `json:"chat_ids"`
	DateFrom   *time.Time `json:"date_from,omitempty"`
	DateTo     *time.Time `json:"date_to,omitempty"`
}

type ExportConversation struct {
	ChatTitle    string              `json:"chat_title"`
	Chat         chats.ChatHeader    `json:"chat"`
	Messages     []chats.MessageView `json:"messages"`
	MessageCount int                 `json:"message_count"`
}

type ExportDocument struct {
	JobID         string               `json:"job_id"`
	GeneratedAt   time.Time            `json:"generated_at"`
	ScopeType     ScopeType            `json:"scope_type"`
	Selection     ExportSelection      `json:"selection"`
	Conversations []ExportConversation `json:"conversations"`
	IncludeMedia  bool                 `json:"include_media"`
	TotalChats    int                  `json:"total_chats"`
	TotalMessages int                  `json:"total_messages"`
}

type CreateJobInput struct {
	AccountIDs   []string   `json:"account_ids"`
	ChatIDs      []string   `json:"chat_ids"`
	DateFrom     *time.Time `json:"date_from,omitempty"`
	DateTo       *time.Time `json:"date_to,omitempty"`
	Format       Format     `json:"format"`
	IncludeMedia bool       `json:"include_media"`
}

type JobView struct {
	ID           string     `json:"id"`
	AccountID    string     `json:"account_id"`
	ChatID       string     `json:"chat_id"`
	AccountIDs   []string   `json:"account_ids"`
	ChatIDs      []string   `json:"chat_ids"`
	DateFrom     *time.Time `json:"date_from,omitempty"`
	DateTo       *time.Time `json:"date_to,omitempty"`
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

type ArtifactFile struct {
	JobID        string
	FilePath     string
	DownloadName string
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
	chatIDs := normalizeIDList(input.ChatIDs)
	if len(chatIDs) == 0 {
		return JobView{}, fmt.Errorf("chat_ids is required")
	}

	format := normalizeFormat(input.Format)
	if format == "" {
		return JobView{}, fmt.Errorf("unsupported export format %q", input.Format)
	}

	if input.DateFrom != nil && input.DateTo != nil && !input.DateFrom.Before(*input.DateTo) {
		return JobView{}, fmt.Errorf("date_to must be later than date_from")
	}

	headers, err := s.chatRepository.ListChatHeadersByIDs(ctx, chatIDs)
	if err != nil {
		return JobView{}, mapChatLookupError(strings.Join(chatIDs, ","), err)
	}

	accountIDs := normalizeIDList(input.AccountIDs)
	if len(accountIDs) == 0 {
		accountIDs = uniqueAccountIDs(headers)
	}
	if len(accountIDs) == 0 {
		return JobView{}, fmt.Errorf("account_ids is required")
	}

	headerAccounts := uniqueAccountIDs(headers)
	if len(accountIDs) != len(headerAccounts) || !sameStringSet(accountIDs, headerAccounts) {
		return JobView{}, fmt.Errorf("selected accounts must match selected chats")
	}

	validAccounts := make(map[string]struct{}, len(accountIDs))
	for _, accountID := range accountIDs {
		validAccounts[accountID] = struct{}{}
	}
	for _, header := range headers {
		if _, ok := validAccounts[header.AccountID]; !ok {
			return JobView{}, fmt.Errorf("chat %s does not belong to selected accounts", header.ID)
		}
	}

	scopeType := ScopeTypeChat
	if len(chatIDs) > 1 || len(accountIDs) > 1 || input.DateFrom != nil || input.DateTo != nil {
		scopeType = ScopeTypeChatBatch
	}

	job := ExportJob{
		ID:           ids.NewUUID(),
		AccountID:    accountIDs[0],
		ChatID:       chatIDs[0],
		AccountIDs:   accountIDs,
		ChatIDs:      chatIDs,
		DateFrom:     input.DateFrom,
		DateTo:       input.DateTo,
		ScopeType:    scopeType,
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

func (s *Service) DeleteJob(ctx context.Context, jobID string) (JobView, error) {
	trimmedID := strings.TrimSpace(jobID)
	job, err := s.repository.GetByID(ctx, trimmedID)
	if err != nil {
		return JobView{}, mapRepositoryError(trimmedID, err)
	}

	if err := s.repository.Delete(ctx, job.ID); err != nil {
		return JobView{}, mapRepositoryError(trimmedID, err)
	}

	if job.ArtifactPath != nil && strings.TrimSpace(*job.ArtifactPath) != "" {
		if err := os.Remove(filepath.Clean(*job.ArtifactPath)); err != nil && !errors.Is(err, os.ErrNotExist) {
			s.logger.Warn("failed to remove export artifact after job deletion", "job_id", job.ID, "artifact_path", *job.ArtifactPath, "error", err)
		}
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

func (s *Service) ArtifactDownloadName(ctx context.Context, jobID string) (string, error) {
	job, err := s.repository.GetByID(ctx, strings.TrimSpace(jobID))
	if err != nil {
		return "", mapRepositoryError(jobID, err)
	}
	if job.ArtifactPath == nil || *job.ArtifactPath == "" {
		return "", fmt.Errorf("artifact is not available")
	}

	return fmt.Sprintf("whatsapp-export-%s%s", job.ID, artifactExtension(job.Format)), nil
}

func (s *Service) ArtifactFiles(ctx context.Context, jobIDs []string) ([]ArtifactFile, error) {
	normalizedIDs := normalizeIDList(jobIDs)
	if len(normalizedIDs) == 0 {
		return nil, fmt.Errorf("job_ids is required")
	}

	files := make([]ArtifactFile, 0, len(normalizedIDs))
	for _, jobID := range normalizedIDs {
		job, err := s.repository.GetByID(ctx, strings.TrimSpace(jobID))
		if err != nil {
			return nil, mapRepositoryError(jobID, err)
		}
		if job.Status != StatusCompleted {
			return nil, fmt.Errorf("job %s is not completed", jobID)
		}
		if job.ArtifactPath == nil || *job.ArtifactPath == "" {
			return nil, fmt.Errorf("artifact is not available for job %s", jobID)
		}

		files = append(files, ArtifactFile{
			JobID:        job.ID,
			FilePath:     *job.ArtifactPath,
			DownloadName: fmt.Sprintf("whatsapp-export-%s%s", job.ID, artifactExtension(job.Format)),
		})
	}

	return files, nil
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
	headers, err := s.chatRepository.ListChatHeadersByIDs(ctx, job.ChatIDs)
	if err != nil {
		return ExportDocument{}, err
	}

	conversations := make([]ExportConversation, 0, len(headers))
	totalMessages := 0

	for _, header := range headers {
		pages := make([][]chats.MessageView, 0)
		var before *time.Time

		for {
			chunk, hasMore, err := s.chatRepository.ListMessages(ctx, chats.MessageListFilters{
				ChatID:   header.ID,
				Limit:    200,
				Before:   before,
				DateFrom: job.DateFrom,
				DateTo:   job.DateTo,
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

		if !job.IncludeMedia {
			for index := range messages {
				messages[index].Media = []chats.MediaAttachment{}
			}
		}

		conversations = append(conversations, ExportConversation{
			ChatTitle:    resolveChatTitle(header),
			Chat:         header,
			Messages:     messages,
			MessageCount: len(messages),
		})
		totalMessages += len(messages)
	}

	return ExportDocument{
		JobID:       job.ID,
		GeneratedAt: time.Now().UTC(),
		ScopeType:   job.ScopeType,
		Selection: ExportSelection{
			AccountIDs: job.AccountIDs,
			ChatIDs:    job.ChatIDs,
			DateFrom:   job.DateFrom,
			DateTo:     job.DateTo,
		},
		Conversations: conversations,
		IncludeMedia:  job.IncludeMedia,
		TotalChats:    len(conversations),
		TotalMessages: totalMessages,
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
		AccountIDs:   job.AccountIDs,
		ChatIDs:      job.ChatIDs,
		DateFrom:     job.DateFrom,
		DateTo:       job.DateTo,
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

func artifactExtension(format Format) string {
	switch format {
	case FormatJSON:
		return ".json"
	case FormatMarkdown:
		return ".md"
	case FormatHTML:
		return ".html"
	default:
		return ""
	}
}

func fallbackExportText(messageType any) string {
	switch strings.ToLower(strings.TrimSpace(fmt.Sprint(messageType))) {
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

func normalizeIDList(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}

	return result
}

func uniqueAccountIDs(headers []chats.ChatHeader) []string {
	seen := make(map[string]struct{}, len(headers))
	accountIDs := make([]string, 0, len(headers))
	for _, header := range headers {
		if _, ok := seen[header.AccountID]; ok {
			continue
		}
		seen[header.AccountID] = struct{}{}
		accountIDs = append(accountIDs, header.AccountID)
	}

	return accountIDs
}

func sameStringSet(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}

	seen := make(map[string]int, len(left))
	for _, value := range left {
		seen[strings.TrimSpace(value)]++
	}
	for _, value := range right {
		trimmed := strings.TrimSpace(value)
		if seen[trimmed] == 0 {
			return false
		}
		seen[trimmed]--
	}

	return true
}

func resolveChatTitle(header chats.ChatHeader) string {
	if header.Title != nil && strings.TrimSpace(*header.Title) != "" {
		return *header.Title
	}

	return header.WAChatJID
}

func formatSelectionDateRange(selection ExportSelection) string {
	switch {
	case selection.DateFrom != nil && selection.DateTo != nil:
		lastDay := selection.DateTo.Add(-time.Second)
		return fmt.Sprintf("%s ~ %s", selection.DateFrom.Format("2006-01-02"), lastDay.Format("2006-01-02"))
	case selection.DateFrom != nil:
		return fmt.Sprintf("自 %s 起", selection.DateFrom.Format("2006-01-02"))
	case selection.DateTo != nil:
		lastDay := selection.DateTo.Add(-time.Second)
		return fmt.Sprintf("截至 %s", lastDay.Format("2006-01-02"))
	default:
		return "全部时间"
	}
}
