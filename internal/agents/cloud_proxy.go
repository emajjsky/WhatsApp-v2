package agents

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/httpx"
	"whatsapp-agent-platform/internal/support/ids"
)

type CloudProxy struct {
	baseURL        string
	authService    *auth.Service
	repository     *Repository
	chatRepository *chats.Repository
	httpClient     *http.Client
}

func NewCloudProxy(baseURL string, authService *auth.Service, repository *Repository, chatRepository *chats.Repository) *CloudProxy {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" || authService == nil || repository == nil || chatRepository == nil {
		return nil
	}

	return &CloudProxy{
		baseURL:        baseURL,
		authService:    authService,
		repository:     repository,
		chatRepository: chatRepository,
		httpClient: &http.Client{
			Timeout: 45 * time.Second,
		},
	}
}

func (p *CloudProxy) HandleGenerateRun(w http.ResponseWriter, r *http.Request) {
	payload, prepared, err := p.prepareDraftPayload(r)
	if err != nil {
		if prepared.RunID != "" {
			p.failPreparedRun(r.Context(), w, prepared.RunID, err)
			return
		}
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	var response struct {
		Result DesktopAgentDraftResult `json:"result"`
		Error  string                  `json:"error"`
	}
	if err := p.postJSON(r.Context(), r, "/api/desktop/agent-runs/generate", payload, &response); err != nil {
		p.failPreparedRun(r.Context(), w, prepared.RunID, err)
		return
	}
	if strings.TrimSpace(response.Error) != "" {
		p.failPreparedRun(r.Context(), w, prepared.RunID, errors.New(response.Error))
		return
	}

	run, err := p.applyCloudDraftResult(r.Context(), prepared, response.Result)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"run": run})
}

func (p *CloudProxy) HandleGenerateRunStream(w http.ResponseWriter, r *http.Request) {
	payload, prepared, err := p.prepareDraftPayload(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	startRun, err := p.repository.GetRunViewByID(r.Context(), prepared.RunID)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	_ = writeAgentRunSSE(w, "start", map[string]any{"run": startRun})

	result, err := p.postStream(r.Context(), r, "/api/desktop/agent-runs/generate/stream", payload, func(text string) error {
		return writeAgentRunSSE(w, "delta", map[string]any{"text": text})
	})
	if err != nil {
		failed, updateErr := p.markRunFailed(r.Context(), prepared.RunID, err.Error())
		errorPayload := map[string]any{"message": err.Error()}
		if updateErr == nil {
			errorPayload["run"] = failed
		}
		_ = writeAgentRunSSE(w, "error", errorPayload)
		return
	}

	finalRun, err := p.applyCloudDraftResult(r.Context(), prepared, result)
	if err != nil {
		_ = writeAgentRunSSE(w, "error", map[string]any{"message": err.Error()})
		return
	}

	_ = writeAgentRunSSE(w, "complete", map[string]any{"run": finalRun})
}

func (p *CloudProxy) HandleTranslateText(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		AccountID          string `json:"account_id"`
		AgentID            string `json:"agent_id,omitempty"`
		Text               string `json:"text"`
		TargetLanguage     string `json:"target_language"`
		TargetLanguageName string `json:"target_language_name,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	var response struct {
		Translation TranslationView `json:"translation"`
		Error       string          `json:"error"`
	}
	if err := p.postJSON(r.Context(), r, "/api/desktop/agent-translations", DesktopAgentTranslationInput{
		RequestID:          ids.NewUUID(),
		AccountID:          payload.AccountID,
		AgentID:            payload.AgentID,
		Text:               payload.Text,
		TargetLanguage:     payload.TargetLanguage,
		TargetLanguageName: payload.TargetLanguageName,
	}, &response); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(response.Error) != "" {
		httpx.WriteError(w, http.StatusBadRequest, response.Error)
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"translation": response.Translation})
}

func (p *CloudProxy) HandleStatusCard(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		ChatID              string `json:"chat_id"`
		AgentID             string `json:"agent_id,omitempty"`
		ContextMessageLimit int    `json:"context_message_limit,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	chatHeader, messages, limit, err := p.loadChatContext(r.Context(), payload.ChatID, payload.ContextMessageLimit, true)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	var response struct {
		StatusCard StatusCardView `json:"status_card"`
		Error      string         `json:"error"`
	}
	if err := p.postJSON(r.Context(), r, "/api/desktop/agent-status-card", DesktopAgentStatusCardInput{
		RequestID:           ids.NewUUID(),
		AccountID:           chatHeader.AccountID,
		ChatID:              chatHeader.ID,
		ChatTitle:           chatHeader.Title,
		AgentID:             payload.AgentID,
		ContextMessageLimit: limit,
		RecentMessages:      chatMessagesToDesktopMessages(messages),
	}, &response); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(response.Error) != "" {
		httpx.WriteError(w, http.StatusBadRequest, response.Error)
		return
	}

	if err := p.repository.UpsertStatusCard(r.Context(), chatHeader.ID, response.StatusCard); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"status_card": response.StatusCard})
}

func (p *CloudProxy) HandleAvailableSystemConfigs(w http.ResponseWriter, r *http.Request) {
	req, err := p.newCloudRequest(r.Context(), r, http.MethodGet, "/api/agent-configs", nil)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	req.URL.RawQuery = r.URL.RawQuery
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("call cloud agent configs: %v", err))
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		httpx.WriteError(w, resp.StatusCode, decodeCloudError(resp).Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}

func (p *CloudProxy) prepareDraftPayload(r *http.Request) (DesktopAgentDraftInput, preparedManualRun, error) {
	var payload struct {
		ChatID              string  `json:"chat_id"`
		AgentID             string  `json:"agent_id,omitempty"`
		MessageText         *string `json:"message_text,omitempty"`
		ContextEnabled      *bool   `json:"context_enabled,omitempty"`
		ContextMessageLimit int     `json:"context_message_limit,omitempty"`
	}
	if err := httpx.DecodeJSON(r, &payload); err != nil {
		return DesktopAgentDraftInput{}, preparedManualRun{}, err
	}

	chatID := strings.TrimSpace(payload.ChatID)
	if chatID == "" {
		return DesktopAgentDraftInput{}, preparedManualRun{}, fmt.Errorf("chat_id is required")
	}

	contextLimit := normalizeContextMessageLimit(payload.ContextMessageLimit)
	chatHeader, messages, _, err := p.loadChatContext(r.Context(), chatID, maxInt(contextLimit+8, 30), false)
	if err != nil {
		return DesktopAgentDraftInput{}, preparedManualRun{}, err
	}

	trigger, ok := latestTextTrigger(messages, true)
	if payload.MessageText != nil && strings.TrimSpace(*payload.MessageText) != "" {
		if !ok {
			trigger, ok = latestTextTrigger(messages, false)
		}
		trigger.Text = strings.TrimSpace(*payload.MessageText)
	}
	if strings.TrimSpace(trigger.Text) == "" || !ok {
		return DesktopAgentDraftInput{}, preparedManualRun{}, fmt.Errorf("no text message is available for agent draft")
	}

	runID := ids.NewUUID()
	createdAt := time.Now().UTC()
	inputContext, err := json.Marshal(map[string]any{
		"chat_title":      chatHeader.Title,
		"wa_chat_jid":     chatHeader.WAChatJID,
		"trigger_text":    trigger.Text,
		"trigger_wa_id":   trigger.WAMessageID,
		"agent_id":        strings.TrimSpace(payload.AgentID),
		"rule_name":       "Cloud Agent",
		"manual":          true,
		"cloud_proxy":     true,
		"context_enabled": optionalBoolValue(payload.ContextEnabled, true),
		"context_limit":   contextLimit,
		"received_at":     createdAt,
	})
	if err != nil {
		return DesktopAgentDraftInput{}, preparedManualRun{}, fmt.Errorf("encode cloud agent run context: %w", err)
	}

	if err := p.repository.CreateRun(r.Context(), AgentRun{
		ID:               runID,
		RuleID:           "",
		AccountID:        chatHeader.AccountID,
		ChatID:           chatID,
		TriggerMessageID: trigger.ID,
		Status:           RunStatusGenerating,
		InputContext:     inputContext,
	}); err != nil {
		return DesktopAgentDraftInput{}, preparedManualRun{}, err
	}

	recentMessages := []DesktopAgentMessage{}
	if optionalBoolValue(payload.ContextEnabled, true) {
		recentMessages = chatMessagesToDesktopMessages(tailMessages(messages, contextLimit))
	}

	return DesktopAgentDraftInput{
			RequestID:           runID,
			AccountID:           chatHeader.AccountID,
			ChatID:              chatHeader.ID,
			ChatTitle:           chatHeader.Title,
			TriggerMessageID:    trigger.ID,
			MessageText:         trigger.Text,
			AgentID:             payload.AgentID,
			ContextEnabled:      optionalBoolValue(payload.ContextEnabled, true),
			ContextMessageLimit: contextLimit,
			RecentMessages:      recentMessages,
		}, preparedManualRun{
			RunID:      runID,
			AccountID:  chatHeader.AccountID,
			ChatHeader: chatHeader,
		}, nil
}

func (p *CloudProxy) loadChatContext(ctx context.Context, chatID string, limit int, statusCard bool) (chats.ChatHeader, []chats.MessageView, int, error) {
	trimmedChatID := strings.TrimSpace(chatID)
	if trimmedChatID == "" {
		return chats.ChatHeader{}, nil, 0, fmt.Errorf("chat_id is required")
	}

	chatHeader, err := p.chatRepository.GetChatHeader(ctx, trimmedChatID)
	if err != nil {
		return chats.ChatHeader{}, nil, 0, err
	}

	resolvedLimit := normalizeContextMessageLimit(limit)
	if statusCard {
		resolvedLimit = limit
		if resolvedLimit <= 0 {
			resolvedLimit = 500
		}
		if resolvedLimit > 500 {
			resolvedLimit = 500
		}
	}

	messages, _, err := p.chatRepository.ListMessages(ctx, chats.MessageListFilters{
		ChatID: trimmedChatID,
		Limit:  resolvedLimit,
	})
	if err != nil {
		return chats.ChatHeader{}, nil, 0, err
	}

	return chatHeader, messages, resolvedLimit, nil
}

func (p *CloudProxy) postJSON(ctx context.Context, r *http.Request, route string, payload any, target any) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode cloud agent request: %w", err)
	}

	req, err := p.newCloudRequest(ctx, r, http.MethodPost, route, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("call cloud agent: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decodeCloudError(resp)
	}

	if err := json.NewDecoder(resp.Body).Decode(target); err != nil {
		return fmt.Errorf("decode cloud agent response: %w", err)
	}

	return nil
}

func (p *CloudProxy) postStream(
	ctx context.Context,
	r *http.Request,
	route string,
	payload any,
	onDelta func(string) error,
) (DesktopAgentDraftResult, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return DesktopAgentDraftResult{}, fmt.Errorf("encode cloud agent stream request: %w", err)
	}

	req, err := p.newCloudRequest(ctx, r, http.MethodPost, route, bytes.NewReader(body))
	if err != nil {
		return DesktopAgentDraftResult{}, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "text/event-stream")

	client := *p.httpClient
	client.Timeout = 0
	resp, err := client.Do(req)
	if err != nil {
		return DesktopAgentDraftResult{}, fmt.Errorf("call cloud agent stream: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return DesktopAgentDraftResult{}, decodeCloudError(resp)
	}

	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}
		raw := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		var envelope struct {
			Text    string                  `json:"text"`
			Result  DesktopAgentDraftResult `json:"result"`
			Message string                  `json:"message"`
		}
		if err := json.Unmarshal([]byte(raw), &envelope); err != nil {
			return DesktopAgentDraftResult{}, fmt.Errorf("decode cloud agent stream event: %w", err)
		}
		if envelope.Message != "" {
			return DesktopAgentDraftResult{}, errors.New(envelope.Message)
		}
		if envelope.Text != "" && onDelta != nil {
			if err := onDelta(envelope.Text); err != nil {
				return DesktopAgentDraftResult{}, err
			}
		}
		if envelope.Result.RequestID != "" {
			return envelope.Result, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return DesktopAgentDraftResult{}, fmt.Errorf("read cloud agent stream: %w", err)
	}

	return DesktopAgentDraftResult{}, fmt.Errorf("cloud agent stream ended before completion")
}

func (p *CloudProxy) newCloudRequest(ctx context.Context, r *http.Request, method string, route string, body io.Reader) (*http.Request, error) {
	endpoint, err := url.JoinPath(p.baseURL, route)
	if err != nil {
		return nil, fmt.Errorf("build cloud agent URL: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, fmt.Errorf("create cloud agent request: %w", err)
	}

	cloudToken, err := p.authService.CloudTokenFromLocalToken(ctx, p.sessionTokenFromRequest(r))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+cloudToken)
	req.Header.Set("User-Agent", "whatsapp-agent-desktop/0.1")
	req.Header.Set("X-Desktop-Device-ID", strings.TrimSpace(r.Header.Get("X-Desktop-Device-ID")))
	req.Header.Set("X-Desktop-Device-Name", strings.TrimSpace(r.Header.Get("X-Desktop-Device-Name")))
	req.Header.Set("X-Desktop-App-Version", strings.TrimSpace(r.Header.Get("X-Desktop-App-Version")))
	return req, nil
}

func (p *CloudProxy) applyCloudDraftResult(
	ctx context.Context,
	prepared preparedManualRun,
	result DesktopAgentDraftResult,
) (RunView, error) {
	completedAt := result.CompletedAt
	if completedAt.IsZero() {
		completedAt = time.Now().UTC()
	}

	status := normalizeRunStatus(result.Status)
	if status == "" {
		status = RunStatusFailed
	}
	if status == RunStatusSent {
		status = RunStatusReadyForReview
	}

	if err := p.repository.UpdateRunStatus(ctx, prepared.RunID, RunStatusUpdate{
		Status:      status,
		OutputDraft: stringPointer(result.Draft),
		BlockReason: stringPointer(result.BlockReason),
		CompletedAt: &completedAt,
	}); err != nil {
		return RunView{}, err
	}

	return p.repository.GetRunViewByID(ctx, prepared.RunID)
}

func (p *CloudProxy) failPreparedRun(ctx context.Context, w http.ResponseWriter, runID string, runErr error) {
	run, err := p.markRunFailed(ctx, runID, runErr.Error())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, runErr.Error())
		return
	}

	httpx.WriteJSON(w, http.StatusCreated, map[string]any{"run": run})
}

func (p *CloudProxy) markRunFailed(ctx context.Context, runID string, reason string) (RunView, error) {
	completedAt := time.Now().UTC()
	if err := p.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
		Status:      RunStatusFailed,
		BlockReason: stringPointer(reason),
		CompletedAt: &completedAt,
	}); err != nil {
		return RunView{}, err
	}

	return p.repository.GetRunViewByID(ctx, runID)
}

func chatMessagesToDesktopMessages(messages []chats.MessageView) []DesktopAgentMessage {
	result := make([]DesktopAgentMessage, 0, len(messages))
	for _, item := range messages {
		text := strings.TrimSpace(derefString(item.TextContent))
		if text == "" && item.MessageType != "" {
			text = fmt.Sprintf("[%s]", item.MessageType)
		}
		if text == "" {
			continue
		}
		role := "customer"
		if item.FromMe {
			role = "agent"
		}
		result = append(result, DesktopAgentMessage{Role: role, Text: text})
	}

	return result
}

func (p *CloudProxy) sessionTokenFromRequest(r *http.Request) string {
	if r == nil {
		return ""
	}
	if token := bearerTokenFromAgentRequest(r); token != "" {
		return token
	}
	cookieName := "wa_session"
	if p.authService != nil {
		cookieName = p.authService.Config().CookieName
	}
	cookie, err := r.Cookie(cookieName)
	if err != nil {
		return ""
	}

	return strings.TrimSpace(cookie.Value)
}

func bearerTokenFromAgentRequest(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}

	return strings.TrimSpace(parts[1])
}

func decodeCloudError(resp *http.Response) error {
	var payload struct {
		Error   string `json:"error"`
		Message string `json:"message"`
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if err := json.Unmarshal(body, &payload); err == nil {
		if strings.TrimSpace(payload.Error) != "" {
			return errors.New(strings.TrimSpace(payload.Error))
		}
		if strings.TrimSpace(payload.Message) != "" {
			return errors.New(strings.TrimSpace(payload.Message))
		}
	}
	message := strings.TrimSpace(string(body))
	if message == "" {
		message = resp.Status
	}
	return fmt.Errorf("cloud agent returned status %d: %s", resp.StatusCode, message)
}
