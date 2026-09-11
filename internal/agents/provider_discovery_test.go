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
