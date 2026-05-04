package scripts

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/support/ids"
)

type Document struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id,omitempty"`
	Title       string    `json:"title"`
	FileName    string    `json:"file_name"`
	ContentType string    `json:"content_type"`
	ByteSize    int64     `json:"byte_size"`
	CreatedAt   time.Time `json:"created_at"`
}

type UploadInput struct {
	Title       string
	FileName    string
	ContentType string
	Data        []byte
}

type storedDocument struct {
	Document
	StorageName string `json:"storage_name"`
}

type Service struct {
	dir    string
	logger *slog.Logger
	mu     sync.Mutex
}

func NewService(dir string, logger *slog.Logger) (*Service, error) {
	if strings.TrimSpace(dir) == "" {
		dir = "data/scripts"
	}
	if logger == nil {
		logger = slog.Default()
	}

	return &Service{
		dir:    dir,
		logger: logger.With("component", "script_service"),
	}, nil
}

func (s *Service) List(ctx context.Context) ([]Document, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	items, err := s.readIndex(ctx)
	if err != nil {
		return nil, err
	}

	result := make([]Document, 0, len(items))
	currentUser, hasUser := auth.CurrentUser(ctx)
	for _, item := range items {
		if hasUser && !currentUser.IsAdmin() && item.UserID != currentUser.ID {
			continue
		}
		result = append(result, item.Document)
	}
	sort.Slice(result, func(left, right int) bool {
		return result[left].CreatedAt.After(result[right].CreatedAt)
	})

	return result, nil
}

func (s *Service) Upload(ctx context.Context, input UploadInput) (Document, error) {
	if len(input.Data) == 0 {
		return Document{}, fmt.Errorf("script content is required")
	}

	fileName := sanitizeFileName(input.FileName)
	if fileName == "" {
		fileName = "script.txt"
	}

	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = strings.TrimSuffix(fileName, filepath.Ext(fileName))
	}
	if title == "" {
		title = "未命名剧本"
	}

	contentType := strings.TrimSpace(input.ContentType)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	now := time.Now().UTC()
	id := ids.NewUUID()
	ownerID := ""
	if currentUser, ok := auth.CurrentUser(ctx); ok {
		ownerID = currentUser.ID
	}
	storageName := id + filepath.Ext(fileName)
	if storageName == id {
		storageName += ".txt"
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return Document{}, fmt.Errorf("create script directory: %w", err)
	}
	if err := os.WriteFile(filepath.Join(s.dir, storageName), input.Data, 0o644); err != nil {
		return Document{}, fmt.Errorf("write script file: %w", err)
	}

	items, err := s.readIndex(ctx)
	if err != nil {
		_ = os.Remove(filepath.Join(s.dir, storageName))
		return Document{}, err
	}

	item := storedDocument{
		Document: Document{
			ID:          id,
			UserID:      ownerID,
			Title:       title,
			FileName:    fileName,
			ContentType: contentType,
			ByteSize:    int64(len(input.Data)),
			CreatedAt:   now,
		},
		StorageName: storageName,
	}
	items = append(items, item)

	if err := s.writeIndex(ctx, items); err != nil {
		_ = os.Remove(filepath.Join(s.dir, storageName))
		return Document{}, err
	}

	return item.Document, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	trimmedID := strings.TrimSpace(id)
	if trimmedID == "" {
		return fmt.Errorf("script id is required")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	items, err := s.readIndex(ctx)
	if err != nil {
		return err
	}

	next := make([]storedDocument, 0, len(items))
	var removed *storedDocument
	currentUser, hasUser := auth.CurrentUser(ctx)
	for _, item := range items {
		if item.ID == trimmedID {
			if hasUser && !currentUser.IsAdmin() && item.UserID != currentUser.ID {
				return fmt.Errorf("script not found: %s", trimmedID)
			}
			copyItem := item
			removed = &copyItem
			continue
		}
		next = append(next, item)
	}
	if removed == nil {
		return fmt.Errorf("script not found: %s", trimmedID)
	}

	if err := s.writeIndex(ctx, next); err != nil {
		return err
	}
	if removed.StorageName != "" {
		if err := os.Remove(filepath.Join(s.dir, removed.StorageName)); err != nil && !os.IsNotExist(err) {
			s.logger.Warn("failed to remove script file", "script_id", removed.ID, "error", err)
		}
	}

	return nil
}

func (s *Service) AssignOrphanDocuments(ctx context.Context, userID string) error {
	trimmedUserID := strings.TrimSpace(userID)
	if trimmedUserID == "" {
		return nil
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	items, err := s.readIndex(ctx)
	if err != nil {
		return err
	}

	changed := false
	for index := range items {
		if strings.TrimSpace(items[index].UserID) == "" {
			items[index].UserID = trimmedUserID
			changed = true
		}
	}
	if !changed {
		return nil
	}

	return s.writeIndex(ctx, items)
}

func (s *Service) readIndex(_ context.Context) ([]storedDocument, error) {
	raw, err := os.ReadFile(s.indexPath())
	if err != nil {
		if os.IsNotExist(err) {
			return []storedDocument{}, nil
		}
		return nil, fmt.Errorf("read script index: %w", err)
	}

	var items []storedDocument
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, fmt.Errorf("decode script index: %w", err)
	}

	return items, nil
}

func (s *Service) writeIndex(_ context.Context, items []storedDocument) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return fmt.Errorf("create script directory: %w", err)
	}

	payload, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return fmt.Errorf("encode script index: %w", err)
	}

	if err := os.WriteFile(s.indexPath(), payload, 0o644); err != nil {
		return fmt.Errorf("write script index: %w", err)
	}

	return nil
}

func (s *Service) indexPath() string {
	return filepath.Join(s.dir, "index.json")
}

func sanitizeFileName(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	return filepath.Base(strings.ReplaceAll(trimmed, "\\", "/"))
}
