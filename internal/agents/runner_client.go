package agents

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type RunnerClient struct {
	baseURL    string
	httpClient *http.Client
}

type RunnerRunRequest struct {
	RequestID         string         `json:"request_id,omitempty"`
	AccountID         string         `json:"account_id"`
	ChatID            string         `json:"chat_id"`
	TriggerMessageID  string         `json:"trigger_message_id"`
	ChatTitle         *string        `json:"chat_title,omitempty"`
	RecentAutoReplies int            `json:"recent_auto_replies,omitempty"`
	Rule              RunnerRule     `json:"rule"`
	Message           RunnerMessage  `json:"message"`
	Context           RunnerContext  `json:"context,omitempty"`
	Provider          map[string]any `json:"provider,omitempty"`
}

type RunnerRule struct {
	Name                    string            `json:"name"`
	Enabled                 bool              `json:"enabled"`
	ReplyMode               ReplyMode         `json:"reply_mode"`
	CooldownSeconds         int               `json:"cooldown_seconds"`
	MaxAutoRepliesPerThread int               `json:"max_auto_replies_per_thread"`
	TriggerFilter           TriggerFilter     `json:"trigger_filter"`
	BlacklistFilter         BlacklistFilter   `json:"blacklist_filter"`
	PromptTemplate          string            `json:"prompt_template"`
	KnowledgeBinding        *KnowledgeBinding `json:"knowledge_binding,omitempty"`
}

type RunnerMessage struct {
	Text string `json:"text"`
}

type RunnerContext struct {
	ChatTitle      *string               `json:"chat_title,omitempty"`
	RecentMessages []RunnerRecentMessage `json:"recent_messages,omitempty"`
}

type RunnerRecentMessage struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type RunnerRunResponse struct {
	RunID            string         `json:"run_id"`
	AccountID        string         `json:"account_id"`
	ChatID           string         `json:"chat_id"`
	TriggerMessageID string         `json:"trigger_message_id"`
	Status           string         `json:"status"`
	Draft            string         `json:"draft"`
	BlockReasons     []string       `json:"block_reasons"`
	Provider         map[string]any `json:"provider"`
	Policy           map[string]any `json:"policy"`
	Dispatch         map[string]any `json:"dispatch"`
	Trace            map[string]any `json:"trace"`
}

func NewRunnerClient(baseURL string) *RunnerClient {
	return &RunnerClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		httpClient: &http.Client{
			Timeout: 25 * time.Second,
		},
	}
}

func (c *RunnerClient) Configured() bool {
	return c != nil && strings.TrimSpace(c.baseURL) != ""
}

func (c *RunnerClient) Run(ctx context.Context, payload RunnerRunRequest) (RunnerRunResponse, error) {
	if c == nil || strings.TrimSpace(c.baseURL) == "" {
		return RunnerRunResponse{}, fmt.Errorf("agent runner is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("encode runner request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/runs", bytes.NewReader(body))
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("build runner request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("call agent runner: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return RunnerRunResponse{}, fmt.Errorf("agent runner returned status %d", resp.StatusCode)
	}

	var decoded RunnerRunResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return RunnerRunResponse{}, fmt.Errorf("decode runner response: %w", err)
	}

	return decoded, nil
}
