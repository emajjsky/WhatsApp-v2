package ingest

import (
	"context"
	"fmt"
)

type PersistResult struct {
	ChatID     string
	ContactID  *string
	MessageID  string
	MediaCount int
}

type Service struct {
	repository *Repository
	normalizer *Normalizer
}

func NewService(repository *Repository, normalizer *Normalizer) (*Service, error) {
	if repository == nil {
		return nil, fmt.Errorf("ingest service requires a repository")
	}
	if normalizer == nil {
		normalizer = NewNormalizer()
	}

	return &Service{
		repository: repository,
		normalizer: normalizer,
	}, nil
}

func (s *Service) PersistEvent(ctx context.Context, event RawEvent) (PersistResult, error) {
	normalized, err := s.normalizer.Normalize(event)
	if err != nil {
		return PersistResult{}, err
	}

	chatID, err := s.repository.UpsertChat(ctx, normalized.Chat)
	if err != nil {
		return PersistResult{}, err
	}

	var contactID *string
	if normalized.Contact != nil {
		id, err := s.repository.UpsertContact(ctx, *normalized.Contact)
		if err != nil {
			return PersistResult{}, err
		}
		contactID = &id
	}

	messageID, err := s.repository.UpsertMessage(ctx, chatID, normalized.Message)
	if err != nil {
		return PersistResult{}, err
	}

	if err := s.repository.ReplaceMedia(ctx, messageID, normalized.Media); err != nil {
		return PersistResult{}, err
	}

	return PersistResult{
		ChatID:     chatID,
		ContactID:  contactID,
		MessageID:  messageID,
		MediaCount: len(normalized.Media),
	}, nil
}
