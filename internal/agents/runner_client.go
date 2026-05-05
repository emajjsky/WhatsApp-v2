package agents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

type RunnerRunStreamEvent struct {
	Type     string
	Text     string
	Response RunnerRunResponse
}

type RunnerTranslationRequest struct {
	RequestID          string         `json:"request_id,omitempty"`
	Text               string         `json:"text"`
	TargetLanguage     string         `json:"target_language"`
	TargetLanguageName string         `json:"target_language_name,omitempty"`
	PromptTemplate     string         `json:"prompt_template,omitempty"`
	Provider           map[string]any `json:"provider,omitempty"`
}

type RunnerTranslationResponse struct {
	RequestID          string         `json:"request_id"`
	SourceLanguageCode string         `json:"source_language_code"`
	SourceLanguageName string         `json:"source_language_name"`
	TargetLanguage     string         `json:"target_language"`
	TargetLanguageName string         `json:"target_language_name"`
	TranslatedText     string         `json:"translated_text"`
	Provider           map[string]any `json:"provider"`
}

type RunnerStatusCardRequest struct {
	RequestID          string                `json:"request_id,omitempty"`
	AccountID          string                `json:"account_id"`
	ChatID             string                `json:"chat_id"`
	ChatTitle          *string               `json:"chat_title,omitempty"`
	PromptTemplate     string                `json:"prompt_template,omitempty"`
	StageLabels        []string              `json:"stage_labels,omitempty"`
	CustomerTypeLabels []string              `json:"customer_type_labels,omitempty"`
	RiskLabels         []string              `json:"risk_labels,omitempty"`
	RecentMessages     []RunnerRecentMessage `json:"recent_messages,omitempty"`
	Provider           map[string]any        `json:"provider,omitempty"`
}

type RunnerStatusCardResponse struct {
	RequestID     string         `json:"request_id"`
	CurrentStage  string         `json:"current_stage"`
	CustomerTypes []string       `json:"customer_types"`
	CurrentRisk   string         `json:"current_risk"`
	Summary       string         `json:"summary"`
	Evidence      []string       `json:"evidence"`
	NextAction    string         `json:"next_action"`
	Confidence    string         `json:"confidence"`
	Provider      map[string]any `json:"provider"`
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

func (c *RunnerClient) RunStream(
	ctx context.Context,
	payload RunnerRunRequest,
	onEvent func(RunnerRunStreamEvent) error,
) (RunnerRunResponse, error) {
	if c == nil || strings.TrimSpace(c.baseURL) == "" {
		return RunnerRunResponse{}, fmt.Errorf("agent runner is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("encode runner request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/runs/stream", bytes.NewReader(body))
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("build runner stream request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	streamClient := *c.httpClient
	streamClient.Timeout = 0

	resp, err := streamClient.Do(req)
	if err != nil {
		return RunnerRunResponse{}, fmt.Errorf("call agent runner stream: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		message := strings.TrimSpace(string(detail))
		if message == "" {
			message = resp.Status
		}
		return RunnerRunResponse{}, fmt.Errorf("agent runner stream returned status %d: %s", resp.StatusCode, message)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var envelope struct {
			Type  string `json:"type"`
			Text  string `json:"text"`
			Error string `json:"error"`
		}
		if err := json.Unmarshal([]byte(line), &envelope); err != nil {
			return RunnerRunResponse{}, fmt.Errorf("decode runner stream event: %w", err)
		}

		switch envelope.Type {
		case "start":
			if onEvent != nil {
				if err := onEvent(RunnerRunStreamEvent{Type: "start"}); err != nil {
					return RunnerRunResponse{}, err
				}
			}
		case "delta":
			if onEvent != nil {
				if err := onEvent(RunnerRunStreamEvent{Type: "delta", Text: envelope.Text}); err != nil {
					return RunnerRunResponse{}, err
				}
			}
		case "complete":
			var decoded RunnerRunResponse
			if err := json.Unmarshal([]byte(line), &decoded); err != nil {
				return RunnerRunResponse{}, fmt.Errorf("decode runner stream completion: %w", err)
			}
			if onEvent != nil {
				if err := onEvent(RunnerRunStreamEvent{Type: "complete", Response: decoded}); err != nil {
					return RunnerRunResponse{}, err
				}
			}
			return decoded, nil
		case "error":
			if strings.TrimSpace(envelope.Error) == "" {
				return RunnerRunResponse{}, fmt.Errorf("agent runner stream failed")
			}
			return RunnerRunResponse{}, fmt.Errorf("%s", envelope.Error)
		default:
			return RunnerRunResponse{}, fmt.Errorf("unknown runner stream event %q", envelope.Type)
		}
	}

	if err := scanner.Err(); err != nil {
		return RunnerRunResponse{}, fmt.Errorf("read runner stream: %w", err)
	}

	return RunnerRunResponse{}, fmt.Errorf("agent runner stream ended before completion")
}

func (c *RunnerClient) Translate(ctx context.Context, payload RunnerTranslationRequest) (RunnerTranslationResponse, error) {
	if c == nil || strings.TrimSpace(c.baseURL) == "" {
		return RunnerTranslationResponse{}, fmt.Errorf("agent runner is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return RunnerTranslationResponse{}, fmt.Errorf("encode runner translation request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/translations", bytes.NewReader(body))
	if err != nil {
		return RunnerTranslationResponse{}, fmt.Errorf("build runner translation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return RunnerTranslationResponse{}, fmt.Errorf("call agent runner translation: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		message := strings.TrimSpace(string(detail))
		if message == "" {
			message = resp.Status
		}
		return RunnerTranslationResponse{}, fmt.Errorf("agent runner translation returned status %d: %s", resp.StatusCode, message)
	}

	var decoded RunnerTranslationResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return RunnerTranslationResponse{}, fmt.Errorf("decode runner translation response: %w", err)
	}

	return decoded, nil
}

func (c *RunnerClient) AnalyzeStatusCard(ctx context.Context, payload RunnerStatusCardRequest) (RunnerStatusCardResponse, error) {
	if c == nil || strings.TrimSpace(c.baseURL) == "" {
		return RunnerStatusCardResponse{}, fmt.Errorf("agent runner is not configured")
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return RunnerStatusCardResponse{}, fmt.Errorf("encode runner status card request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/status-card", bytes.NewReader(body))
	if err != nil {
		return RunnerStatusCardResponse{}, fmt.Errorf("build runner status card request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return RunnerStatusCardResponse{}, fmt.Errorf("call agent runner status card: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		message := strings.TrimSpace(string(detail))
		if message == "" {
			message = resp.Status
		}
		return RunnerStatusCardResponse{}, fmt.Errorf("agent runner status card returned status %d: %s", resp.StatusCode, message)
	}

	var decoded RunnerStatusCardResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return RunnerStatusCardResponse{}, fmt.Errorf("decode runner status card response: %w", err)
	}

	return decoded, nil
}
