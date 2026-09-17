package agents

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"whatsapp-agent-platform/internal/auth"
)

func TestTranscribeAudioUsesDefaultASRProvider(t *testing.T) {
	audio := []byte("test-audio-content")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" {
			t.Fatalf("request path = %q, want /v1/audio/transcriptions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization = %q, want Bearer test-key", got)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatalf("ParseMultipartForm() error = %v", err)
		}
		if got := r.FormValue("model"); got != "whisper-test" {
			t.Fatalf("model = %q, want whisper-test", got)
		}
		if got := r.FormValue("response_format"); got != "json" {
			t.Fatalf("response_format = %q, want json", got)
		}
		file, _, err := r.FormFile("file")
		if err != nil {
			t.Fatalf("FormFile() error = %v", err)
		}
		defer file.Close()
		gotAudio, err := io.ReadAll(file)
		if err != nil {
			t.Fatalf("ReadAll(file) error = %v", err)
		}
		if string(gotAudio) != string(audio) {
			t.Fatalf("audio = %q, want %q", gotAudio, audio)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"text": "Hola, necesito ayuda.", "language": "es"})
	}))
	defer server.Close()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()

	now := time.Now().UTC()
	query := regexp.QuoteMeta(`
SELECT id, name, provider_type, base_url, api_key, text_enabled, models, default_model,
       asr_enabled, asr_base_url, asr_model, is_default_asr, enabled, created_at, updated_at
FROM agent_provider_presets
WHERE enabled = TRUE AND asr_enabled = TRUE AND is_default_asr = TRUE
LIMIT 1`)
	mock.ExpectQuery(query).WillReturnRows(sqlmock.NewRows([]string{
		"id", "name", "provider_type", "base_url", "api_key", "text_enabled", "models", "default_model",
		"asr_enabled", "asr_base_url", "asr_model", "is_default_asr", "enabled", "created_at", "updated_at",
	}).AddRow(
		"provider-1", "ASR Provider", "openai_compatible", server.URL, "test-key", false, []byte(`[]`), "",
		true, "", "whisper-test", true, true, now, now,
	))

	repository, err := NewRepository(db)
	if err != nil {
		t.Fatalf("NewRepository() error = %v", err)
	}
	service, err := NewService(repository, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	ctx := auth.ContextWithUser(context.Background(), auth.User{ID: "user-1", Role: auth.RoleUser})
	result, err := service.TranscribeAudio(ctx, "", "voice.ogg", "audio/ogg", audio)
	if err != nil {
		t.Fatalf("TranscribeAudio() error = %v", err)
	}
	if result.Text != "Hola, necesito ayuda." || result.SourceLanguageCode != "es" {
		t.Fatalf("TranscribeAudio() = %#v", result)
	}
	if result.ProviderName != "ASR Provider" || result.Model != "whisper-test" {
		t.Fatalf("provider result = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("database expectations: %v", err)
	}
}

func TestTranscribeAudioUsesOpenRouterAudioInput(t *testing.T) {
	audio := []byte("ogg-opus-audio")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/chat/completions" {
			t.Fatalf("request path = %q, want /api/v1/chat/completions", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer openrouter-key" {
			t.Fatalf("Authorization = %q", got)
		}
		var payload struct {
			Model    string `json:"model"`
			Messages []struct {
				Content []struct {
					Type       string `json:"type"`
					InputAudio struct {
						Data   string `json:"data"`
						Format string `json:"format"`
					} `json:"input_audio"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if payload.Model != "google/gemini-2.5-flash-lite" {
			t.Fatalf("model = %q", payload.Model)
		}
		if len(payload.Messages) != 1 || len(payload.Messages[0].Content) != 2 {
			t.Fatalf("messages = %#v", payload.Messages)
		}
		input := payload.Messages[0].Content[1]
		if input.Type != "input_audio" || input.InputAudio.Format != "ogg" {
			t.Fatalf("audio input = %#v", input)
		}
		if input.InputAudio.Data != base64.StdEncoding.EncodeToString(audio) {
			t.Fatal("audio data was not base64 encoded correctly")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("{\"choices\":[{\"message\":{\"content\":\"```json\\n{\\\"text\\\":\\\"Selamat pagi\\\",\\\"language\\\":\\\"id\\\"}\\n```\"}}]}"))
	}))
	defer server.Close()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New() error = %v", err)
	}
	defer db.Close()
	now := time.Now().UTC()
	query := regexp.QuoteMeta(`
SELECT id, name, provider_type, base_url, api_key, text_enabled, models, default_model,
       asr_enabled, asr_base_url, asr_model, is_default_asr, enabled, created_at, updated_at
FROM agent_provider_presets
WHERE enabled = TRUE AND asr_enabled = TRUE AND is_default_asr = TRUE
LIMIT 1`)
	mock.ExpectQuery(query).WillReturnRows(sqlmock.NewRows([]string{
		"id", "name", "provider_type", "base_url", "api_key", "text_enabled", "models", "default_model",
		"asr_enabled", "asr_base_url", "asr_model", "is_default_asr", "enabled", "created_at", "updated_at",
	}).AddRow(
		"provider-openrouter", "OpenRouter ASR", "openrouter", server.URL, "openrouter-key", false, []byte(`[]`), "",
		true, "", "google/gemini-2.5-flash-lite", true, true, now, now,
	))
	repository, err := NewRepository(db)
	if err != nil {
		t.Fatalf("NewRepository() error = %v", err)
	}
	service, err := NewService(repository, nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}
	ctx := auth.ContextWithUser(context.Background(), auth.User{ID: "user-1", Role: auth.RoleUser})
	result, err := service.TranscribeAudio(ctx, "", "voice.ogg", "audio/ogg; codecs=opus", audio)
	if err != nil {
		t.Fatalf("TranscribeAudio() error = %v", err)
	}
	if result.Text != "Selamat pagi" || result.SourceLanguageCode != "id" || result.Model != "google/gemini-2.5-flash-lite" {
		t.Fatalf("TranscribeAudio() = %#v", result)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("database expectations: %v", err)
	}
}
