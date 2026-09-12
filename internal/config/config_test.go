package config

import (
	"testing"
	"time"
)

func TestLoadUsesLongHTTPWriteTimeoutByDefault(t *testing.T) {
	t.Setenv("APP_ENV", "test")
	t.Setenv("HTTP_WRITE_TIMEOUT", "")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}

	if cfg.HTTP.WriteTimeout < 3*time.Minute {
		t.Fatalf("HTTP write timeout = %s, want at least 3m", cfg.HTTP.WriteTimeout)
	}
}
