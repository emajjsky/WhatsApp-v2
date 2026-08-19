package agents

import "testing"

func TestRedactProviderSecrets(t *testing.T) {
	config := map[string]any{
		"type":          "openai_compatible",
		"api_key":       "secret-key",
		"authorization": "Bearer secret",
		"model":         "test-model",
	}

	redacted := redactProviderSecrets(config)
	if _, ok := redacted["api_key"]; ok {
		t.Fatal("api_key must not be returned")
	}
	if _, ok := redacted["authorization"]; ok {
		t.Fatal("authorization must not be returned")
	}
	if redacted["api_key_configured"] != true || redacted["authorization_configured"] != true {
		t.Fatal("configured flags must be returned")
	}
	if redacted["model"] != "test-model" {
		t.Fatal("non-secret provider fields must be preserved")
	}
}

func TestPreserveProviderSecretsWhenEditing(t *testing.T) {
	existing := map[string]any{
		"type":          "openai_compatible",
		"api_key":       "old-key",
		"authorization": "Bearer old",
	}
	incoming := map[string]any{
		"type":                     "openai_compatible",
		"model":                    "new-model",
		"api_key_configured":       true,
		"authorization_configured": true,
	}

	merged := preserveProviderSecrets(incoming, existing)
	if merged["api_key"] != "old-key" || merged["authorization"] != "Bearer old" {
		t.Fatal("empty secret fields must preserve existing values")
	}
	if _, ok := merged["api_key_configured"]; ok {
		t.Fatal("configured marker must not be persisted")
	}
	if merged["model"] != "new-model" {
		t.Fatal("non-secret fields must be updated")
	}
}

func TestProviderSecretIsNotPreservedAcrossProviderChange(t *testing.T) {
	merged := preserveProviderSecrets(
		map[string]any{"type": "webhook"},
		map[string]any{"type": "openai_compatible", "api_key": "old-key"},
	)
	if _, ok := merged["api_key"]; ok {
		t.Fatal("secret must not cross provider type changes")
	}
}
