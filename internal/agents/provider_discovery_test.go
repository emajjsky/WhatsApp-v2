package agents

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"whatsapp-agent-platform/internal/auth"
)

func TestOpenAIModelsURL(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{name: "versioned base", baseURL: "https://api.example.com/v1", want: "https://api.example.com/v1/models"},
		{name: "unversioned base", baseURL: "https://api.example.com", want: "https://api.example.com/v1/models"},
		{name: "completion endpoint", baseURL: "https://api.example.com/v1/chat/completions", want: "https://api.example.com/v1/models"},
		{name: "models endpoint", baseURL: "https://api.example.com/v1/models", want: "https://api.example.com/v1/models"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := openAIModelsURL(test.baseURL)
			if err != nil {
				t.Fatalf("openAIModelsURL() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("openAIModelsURL() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestOpenAIModelsURLRejectsInvalidURL(t *testing.T) {
	if _, err := openAIModelsURL("localhost:8080/v1"); err == nil {
		t.Fatal("openAIModelsURL() expected an error for a URL without an HTTP scheme")
	}
}

func TestOpenAIAudioTranscriptionsURL(t *testing.T) {
	tests := []struct {
		name    string
		baseURL string
		want    string
	}{
		{name: "versioned base", baseURL: "https://api.example.com/v1", want: "https://api.example.com/v1/audio/transcriptions"},
		{name: "unversioned base", baseURL: "https://api.example.com", want: "https://api.example.com/v1/audio/transcriptions"},
		{name: "completion endpoint", baseURL: "https://api.example.com/v1/chat/completions", want: "https://api.example.com/v1/audio/transcriptions"},
		{name: "models endpoint", baseURL: "https://api.example.com/v1/models", want: "https://api.example.com/v1/audio/transcriptions"},
		{name: "transcription endpoint", baseURL: "https://api.example.com/v1/audio/transcriptions", want: "https://api.example.com/v1/audio/transcriptions"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := openAIAudioTranscriptionsURL(test.baseURL)
			if err != nil {
				t.Fatalf("openAIAudioTranscriptionsURL() error = %v", err)
			}
			if got != test.want {
				t.Fatalf("openAIAudioTranscriptionsURL() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestOpenAIAudioTranscriptionsURLRejectsInvalidURL(t *testing.T) {
	if _, err := openAIAudioTranscriptionsURL("localhost:8080/v1"); err == nil {
		t.Fatal("openAIAudioTranscriptionsURL() expected an error for a URL without an HTTP scheme")
	}
}

func TestOpenRouterChatCompletionsURL(t *testing.T) {
	for _, test := range []struct {
		baseURL string
		want    string
	}{
		{baseURL: "", want: "https://openrouter.ai/api/v1/chat/completions"},
		{baseURL: "https://openrouter.ai", want: "https://openrouter.ai/api/v1/chat/completions"},
		{baseURL: "https://openrouter.ai/api/v1", want: "https://openrouter.ai/api/v1/chat/completions"},
		{baseURL: "https://gateway.example.com/v1", want: "https://gateway.example.com/v1/chat/completions"},
		{baseURL: "https://gateway.example.com/v1/chat/completions", want: "https://gateway.example.com/v1/chat/completions"},
	} {
		got, err := openRouterChatCompletionsURL(test.baseURL)
		if err != nil {
			t.Fatalf("openRouterChatCompletionsURL(%q) error = %v", test.baseURL, err)
		}
		if got != test.want {
			t.Fatalf("openRouterChatCompletionsURL(%q) = %q, want %q", test.baseURL, got, test.want)
		}
	}
}

func TestParseProviderModels(t *testing.T) {
	body := []byte(`{"data":[{"id":"model-b"},{"id":"model-a"},{"id":"model-b"},{"name":"model-c"}]}`)
	want := []string{"model-b", "model-a", "model-c"}

	got, err := parseProviderModels(body)
	if err != nil {
		t.Fatalf("parseProviderModels() error = %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseProviderModels() = %#v, want %#v", got, want)
	}
}

func TestDiscoverProviderModels(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			t.Fatalf("request path = %q, want /v1/models", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Fatalf("Authorization = %q, want Bearer test-key", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"id":"model-a"},{"id":"model-b"},{"id":"model-a"}]}`))
	}))
	defer server.Close()

	ctx := auth.ContextWithUser(context.Background(), auth.User{ID: "admin-1", Role: auth.RoleAdmin})
	service := &Service{}
	result, err := service.DiscoverProviderModels(ctx, DiscoverProviderModelsInput{
		ProviderType: "openai_compatible",
		BaseURL:      server.URL,
		APIKey:       "test-key",
	})
	if err != nil {
		t.Fatalf("DiscoverProviderModels() error = %v", err)
	}
	want := []string{"model-a", "model-b"}
	if !reflect.DeepEqual(result.Models, want) {
		t.Fatalf("DiscoverProviderModels() = %#v, want %#v", result.Models, want)
	}
}

func TestUpsertProviderPresetRequiresExactlyOneCapability(t *testing.T) {
	textEnabled := true
	service := &Service{}
	ctx := auth.ContextWithUser(context.Background(), auth.User{ID: "admin-1", Role: auth.RoleAdmin})

	for _, test := range []struct {
		name     string
		text     bool
		asr      bool
		models   []string
		asrModel string
	}{
		{name: "both enabled", text: true, asr: true, models: []string{"text-model"}, asrModel: "asr-model"},
		{name: "both disabled", text: false, asr: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			textEnabled = test.text
			_, err := service.UpsertProviderPreset(ctx, UpsertProviderPresetInput{
				Name:         "Provider",
				ProviderType: "openai_compatible",
				BaseURL:      "https://api.example.com/v1",
				APIKey:       "test-key",
				TextEnabled:  &textEnabled,
				Models:       test.models,
				ASREnabled:   test.asr,
				ASRModel:     test.asrModel,
				Enabled:      true,
			})
			if err == nil || err.Error() != "Provider 必须且只能选择文本模型或语音转写能力" {
				t.Fatalf("UpsertProviderPreset() error = %v", err)
			}
		})
	}
}
