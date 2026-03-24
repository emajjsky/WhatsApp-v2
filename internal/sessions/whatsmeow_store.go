package sessions

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type StoredCredentials struct {
	AccountID        string
	Payload          []byte
	NoiseKeysVersion int
	DeviceID         *string
	LastSyncedAt     time.Time
}

type CredentialStoreAdapter struct {
	repository *CredentialRepository
}

func NewCredentialStoreAdapter(repository *CredentialRepository) (*CredentialStoreAdapter, error) {
	if repository == nil {
		return nil, fmt.Errorf("credential store adapter requires a repository")
	}

	return &CredentialStoreAdapter{repository: repository}, nil
}

func (a *CredentialStoreAdapter) Save(
	ctx context.Context,
	accountID string,
	payload []byte,
	noiseKeysVersion int,
	deviceID *string,
) error {
	if len(payload) == 0 {
		return fmt.Errorf("credential payload must not be empty")
	}

	record := CredentialRecord{
		AccountID:        accountID,
		CredentialBlob:   payload,
		NoiseKeysVersion: noiseKeysVersion,
		DeviceID:         deviceID,
		LastSyncedAt:     time.Now().UTC(),
	}

	return a.repository.Upsert(ctx, record)
}

func (a *CredentialStoreAdapter) Load(ctx context.Context, accountID string) (StoredCredentials, error) {
	record, err := a.repository.GetByAccountID(ctx, accountID)
	if err != nil {
		return StoredCredentials{}, err
	}

	return StoredCredentials{
		AccountID:        record.AccountID,
		Payload:          record.CredentialBlob,
		NoiseKeysVersion: record.NoiseKeysVersion,
		DeviceID:         record.DeviceID,
		LastSyncedAt:     record.LastSyncedAt,
	}, nil
}

func (a *CredentialStoreAdapter) Delete(ctx context.Context, accountID string) error {
	return a.repository.DeleteByAccountID(ctx, accountID)
}

func (a *CredentialStoreAdapter) SaveDeviceBinding(ctx context.Context, accountID string, deviceID *string) error {
	if strings.TrimSpace(accountID) == "" {
		return fmt.Errorf("account_id is required")
	}

	return a.repository.UpsertDeviceBinding(ctx, accountID, deviceID)
}

func (a *CredentialStoreAdapter) LoadDeviceBinding(ctx context.Context, accountID string) (*string, error) {
	if strings.TrimSpace(accountID) == "" {
		return nil, fmt.Errorf("account_id is required")
	}

	deviceID, err := a.repository.GetDeviceIDByAccountID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	return deviceID, nil
}
