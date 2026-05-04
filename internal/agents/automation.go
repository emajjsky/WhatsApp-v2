package agents

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/sessions"
	"whatsapp-agent-platform/internal/support/ids"
)

type SessionRuntime interface {
	Subscribe(buffer int) (<-chan sessions.Event, func())
	SendText(ctx context.Context, accountID, chatJID, text string) (sessions.SendResult, error)
}

type Automation struct {
	repository      *Repository
	chatRepository  *chats.Repository
	sessionRuntime  SessionRuntime
	runner          *RunnerClient
	logger          *slog.Logger
	now             func() time.Time
	autoSendEnabled bool
	maxConcurrent   int
}

func NewAutomation(
	repository *Repository,
	chatRepository *chats.Repository,
	sessionRuntime SessionRuntime,
	runner *RunnerClient,
	autoSendEnabled bool,
	logger *slog.Logger,
) (*Automation, error) {
	if repository == nil {
		return nil, fmt.Errorf("agent automation requires a repository")
	}
	if chatRepository == nil {
		return nil, fmt.Errorf("agent automation requires a chat repository")
	}
	if sessionRuntime == nil {
		return nil, fmt.Errorf("agent automation requires a session runtime")
	}
	if logger == nil {
		logger = slog.Default()
	}
	if runner == nil {
		runner = NewRunnerClient("")
	}

	return &Automation{
		repository:      repository,
		chatRepository:  chatRepository,
		sessionRuntime:  sessionRuntime,
		runner:          runner,
		logger:          logger.With("component", "agent_automation"),
		now:             func() time.Time { return time.Now().UTC() },
		autoSendEnabled: autoSendEnabled,
		maxConcurrent:   4,
	}, nil
}

func (a *Automation) Run(ctx context.Context) {
	events, cancel := a.sessionRuntime.Subscribe(128)
	defer cancel()

	sem := make(chan struct{}, a.maxConcurrent)

	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-events:
			if !ok {
				return
			}
			if event.Type != sessions.EventTypeMessageReceived || event.Message == nil {
				continue
			}

			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			go func(event sessions.Event) {
				defer func() { <-sem }()

				if err := a.handleMessageEvent(ctx, event); err != nil {
					a.logger.Warn(
						"agent automation failed to process message event",
						"account_id", event.AccountID,
						"error", err,
					)
				}
			}(event)
		}
	}
}

type SendRunInput struct {
	MessageText *string
}

type GenerateRunInput struct {
	ChatID              string
	AgentID             string
	RuleID              string
	MessageText         *string
	ContextEnabled      bool
	ContextMessageLimit int
}

type GenerateRunStreamCallbacks struct {
	OnStart func(RunView) error
	OnDelta func(string) error
}

type TranslateTextInput struct {
	AccountID          string
	AgentID            string
	Text               string
	TargetLanguage     string
	TargetLanguageName string
}

type TranslationView struct {
	SourceLanguageCode string `json:"source_language_code"`
	SourceLanguageName string `json:"source_language_name"`
	TargetLanguage     string `json:"target_language"`
	TargetLanguageName string `json:"target_language_name"`
	TranslatedText     string `json:"translated_text"`
}

type preparedManualRun struct {
	RunID         string
	AccountID     string
	ChatHeader    chats.ChatHeader
	RunRule       AgentRule
	RunnerRequest RunnerRunRequest
}

func (a *Automation) SendRun(ctx context.Context, runID string, input SendRunInput) (RunView, error) {
	if a == nil {
		return RunView{}, fmt.Errorf("agent automation is not configured")
	}

	run, err := a.repository.GetRunViewByID(ctx, strings.TrimSpace(runID))
	if err != nil {
		return RunView{}, err
	}

	if run.Status != RunStatusReadyForReview {
		return RunView{}, fmt.Errorf("agent run is not ready for review")
	}
	if run.WAChatJID == nil || strings.TrimSpace(*run.WAChatJID) == "" {
		return RunView{}, fmt.Errorf("chat does not have a wa_chat_jid")
	}

	var textToSend string
	if input.MessageText != nil {
		textToSend = strings.TrimSpace(*input.MessageText)
	}
	if textToSend == "" && run.OutputDraft != nil {
		textToSend = strings.TrimSpace(*run.OutputDraft)
	}
	if textToSend == "" {
		return RunView{}, fmt.Errorf("draft is empty")
	}

	sendResult, err := a.sessionRuntime.SendText(ctx, run.AccountID, *run.WAChatJID, textToSend)
	if err != nil {
		completedAt := a.now()
		_ = a.repository.UpdateRunStatus(ctx, run.ID, RunStatusUpdate{
			Status:      RunStatusFailed,
			OutputDraft: stringPointer(textToSend),
			BlockReason: stringPointer(fmt.Sprintf("send failed: %v", err)),
			CompletedAt: &completedAt,
		})
		return RunView{}, err
	}

	sentMessageID, _ := a.awaitMessageID(ctx, run.AccountID, sendResult.WAMessageID, 18, 150*time.Millisecond)
	completedAt := a.now()

	var sentMessageIDPtr *string
	if sentMessageID != "" {
		sentMessageIDPtr = &sentMessageID
	}

	if err := a.repository.UpdateRunStatus(ctx, run.ID, RunStatusUpdate{
		Status:        RunStatusSent,
		OutputDraft:   stringPointer(textToSend),
		SentMessageID: sentMessageIDPtr,
		CompletedAt:   &completedAt,
	}); err != nil {
		return RunView{}, err
	}

	return a.repository.GetRunViewByID(ctx, run.ID)
}

func (a *Automation) GenerateRun(ctx context.Context, input GenerateRunInput) (RunView, error) {
	prepared, err := a.prepareManualRun(ctx, input)
	if err != nil {
		if prepared.RunID != "" {
			return a.failRun(ctx, prepared.RunID, err.Error())
		}
		return RunView{}, err
	}

	runnerResp, err := a.runner.Run(ctx, prepared.RunnerRequest)
	if err != nil {
		return a.failRun(ctx, prepared.RunID, fmt.Sprintf("agent runner failed: %v", err))
	}

	if err := a.applyRunnerDecision(
		ctx,
		prepared.RunID,
		prepared.AccountID,
		prepared.ChatHeader,
		prepared.RunRule,
		runnerResp,
	); err != nil {
		return RunView{}, err
	}

	return a.repository.GetRunViewByID(ctx, prepared.RunID)
}

func (a *Automation) GenerateRunStream(
	ctx context.Context,
	input GenerateRunInput,
	callbacks GenerateRunStreamCallbacks,
) (RunView, error) {
	prepared, err := a.prepareManualRun(ctx, input)
	if prepared.RunID != "" && callbacks.OnStart != nil {
		run, loadErr := a.repository.GetRunViewByID(ctx, prepared.RunID)
		if loadErr != nil {
			return RunView{}, loadErr
		}
		if callbackErr := callbacks.OnStart(run); callbackErr != nil {
			return run, callbackErr
		}
	}
	if err != nil {
		if prepared.RunID != "" {
			failed, updateErr := a.failRun(ctx, prepared.RunID, err.Error())
			if updateErr != nil {
				return RunView{}, updateErr
			}
			return failed, err
		}
		return RunView{}, err
	}

	runnerResp, err := a.runner.RunStream(ctx, prepared.RunnerRequest, func(event RunnerRunStreamEvent) error {
		if event.Type != "delta" || callbacks.OnDelta == nil {
			return nil
		}
		return callbacks.OnDelta(event.Text)
	})
	if err != nil {
		failed, updateErr := a.failRun(ctx, prepared.RunID, fmt.Sprintf("agent runner failed: %v", err))
		if updateErr != nil {
			return RunView{}, updateErr
		}
		return failed, err
	}

	if err := a.applyRunnerDecision(
		ctx,
		prepared.RunID,
		prepared.AccountID,
		prepared.ChatHeader,
		prepared.RunRule,
		runnerResp,
	); err != nil {
		return RunView{}, err
	}

	return a.repository.GetRunViewByID(ctx, prepared.RunID)
}

func (a *Automation) TranslateText(ctx context.Context, input TranslateTextInput) (TranslationView, error) {
	if a == nil {
		return TranslationView{}, fmt.Errorf("agent automation is not configured")
	}
	if !a.runner.Configured() {
		return TranslationView{}, fmt.Errorf("agent runner is not configured (AGENT_RUNNER_BASE_URL)")
	}

	accountID := strings.TrimSpace(input.AccountID)
	if accountID == "" {
		return TranslationView{}, fmt.Errorf("account_id is required")
	}
	text := strings.TrimSpace(input.Text)
	if text == "" {
		return TranslationView{}, fmt.Errorf("text is required")
	}
	targetLanguage := strings.TrimSpace(input.TargetLanguage)
	if targetLanguage == "" {
		targetLanguage = "zh-CN"
	}
	targetLanguageName := strings.TrimSpace(input.TargetLanguageName)
	if targetLanguageName == "" {
		targetLanguageName = targetLanguage
	}

	systemConfig, err := a.resolveSystemAgentConfig(ctx, strings.TrimSpace(input.AgentID), AgentPurposeTranslation)
	if err != nil || !systemConfig.Enabled {
		return TranslationView{}, fmt.Errorf("no translation agent is configured in admin backend")
	}
	rule := systemConfigRule(accountID, systemConfig)

	providerConfig, err := a.buildRunnerProvider(ctx, accountID, rule)
	if err != nil {
		return TranslationView{}, fmt.Errorf("load admin translation agent config failed: %w", err)
	}

	response, err := a.runner.Translate(ctx, RunnerTranslationRequest{
		RequestID:          ids.NewUUID(),
		Text:               text,
		TargetLanguage:     targetLanguage,
		TargetLanguageName: targetLanguageName,
		PromptTemplate:     resolveRunnerPrompt(rule, providerConfig),
		Provider:           providerConfig,
	})
	if err != nil {
		return TranslationView{}, err
	}

	return TranslationView{
		SourceLanguageCode: strings.TrimSpace(response.SourceLanguageCode),
		SourceLanguageName: strings.TrimSpace(response.SourceLanguageName),
		TargetLanguage:     strings.TrimSpace(response.TargetLanguage),
		TargetLanguageName: strings.TrimSpace(response.TargetLanguageName),
		TranslatedText:     strings.TrimSpace(response.TranslatedText),
	}, nil
}

func (a *Automation) prepareManualRun(ctx context.Context, input GenerateRunInput) (preparedManualRun, error) {
	if a == nil {
		return preparedManualRun{}, fmt.Errorf("agent automation is not configured")
	}

	chatID := strings.TrimSpace(input.ChatID)
	if chatID == "" {
		return preparedManualRun{}, fmt.Errorf("chat_id is required")
	}

	chatHeader, err := a.chatRepository.GetChatHeader(ctx, chatID)
	if err != nil {
		return preparedManualRun{}, err
	}

	contextLimit := normalizeContextMessageLimit(input.ContextMessageLimit)
	trigger, recentMessages, err := a.resolveManualTrigger(ctx, chatID, input.MessageText, contextLimit)
	if err != nil {
		return preparedManualRun{}, err
	}

	selected, err := a.resolveManualRule(ctx, chatHeader, chatID, trigger.Text, input.AgentID, input.RuleID)
	if err != nil {
		return preparedManualRun{}, err
	}

	runRule := selected
	runRule.ReplyMode = ReplyModeSuggest

	runID := ids.NewUUID()
	createdAt := a.now()
	contextMessages := []RunnerRecentMessage{}
	if input.ContextEnabled {
		contextMessages = buildRunnerRecentMessages(tailMessages(recentMessages, contextLimit))
	}

	inputContext, err := json.Marshal(map[string]any{
		"chat_title":        chatHeader.Title,
		"wa_chat_jid":       chatHeader.WAChatJID,
		"trigger_text":      trigger.Text,
		"trigger_wa_id":     trigger.WAMessageID,
		"agent_id":          selected.ID,
		"rule_name":         selected.Name,
		"rule_reply_mode":   selected.ReplyMode,
		"manual":            true,
		"context_enabled":   input.ContextEnabled,
		"context_limit":     contextLimit,
		"runner_configured": a.runner.Configured(),
		"received_at":       createdAt,
	})
	if err != nil {
		return preparedManualRun{}, fmt.Errorf("encode manual agent run context: %w", err)
	}

	prepared := preparedManualRun{
		RunID:      runID,
		AccountID:  chatHeader.AccountID,
		ChatHeader: chatHeader,
		RunRule:    runRule,
	}

	if err := a.repository.CreateRun(ctx, AgentRun{
		ID:               runID,
		RuleID:           "",
		AccountID:        chatHeader.AccountID,
		ChatID:           chatID,
		TriggerMessageID: trigger.ID,
		Status:           RunStatusGenerating,
		InputContext:     inputContext,
	}); err != nil {
		return preparedManualRun{}, err
	}

	if !a.runner.Configured() {
		return prepared, fmt.Errorf("agent runner is not configured (AGENT_RUNNER_BASE_URL)")
	}

	providerConfig, err := a.buildRunnerProvider(ctx, chatHeader.AccountID, selected)
	if err != nil {
		return prepared, fmt.Errorf("load agent settings failed: %w", err)
	}
	resolvedPrompt := resolveRunnerPrompt(selected, providerConfig)

	prepared.RunnerRequest = RunnerRunRequest{
		RequestID:        runID,
		AccountID:        chatHeader.AccountID,
		ChatID:           chatID,
		TriggerMessageID: trigger.ID,
		ChatTitle:        chatHeader.Title,
		Rule: RunnerRule{
			Name:                    runRule.Name,
			Enabled:                 runRule.Enabled,
			ReplyMode:               runRule.ReplyMode,
			CooldownSeconds:         runRule.CooldownSeconds,
			MaxAutoRepliesPerThread: runRule.MaxAutoRepliesPerThread,
			TriggerFilter:           runRule.TriggerFilter,
			BlacklistFilter:         runRule.BlacklistFilter,
			PromptTemplate:          resolvedPrompt,
			KnowledgeBinding:        runRule.KnowledgeBinding,
		},
		Message: RunnerMessage{Text: trigger.Text},
		Context: RunnerContext{
			ChatTitle:      chatHeader.Title,
			RecentMessages: contextMessages,
		},
		Provider: providerConfig,
	}

	return prepared, nil
}

func (a *Automation) failRun(ctx context.Context, runID string, reason string) (RunView, error) {
	completedAt := a.now()
	if err := a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
		Status:      RunStatusFailed,
		BlockReason: stringPointer(reason),
		CompletedAt: &completedAt,
	}); err != nil {
		return RunView{}, err
	}

	return a.repository.GetRunViewByID(ctx, runID)
}

func (a *Automation) handleMessageEvent(ctx context.Context, event sessions.Event) error {
	// Agent generation is intentionally manual-only in the chat workspace.
	// Admin backend system configs are used when the user explicitly generates a draft.
	return nil

	message := event.Message
	if message == nil {
		return nil
	}

	if strings.TrimSpace(event.AccountID) == "" {
		return fmt.Errorf("message event missing account_id")
	}

	if source, ok := message.Payload["source"].(string); ok && source == "history_sync" {
		return nil
	}

	if message.Message.FromMe {
		// Avoid loops. Rules can opt in later via trigger_filter.ignore_from_me=false if needed.
		return nil
	}

	text := ""
	if message.Message.TextContent != nil {
		text = strings.TrimSpace(*message.Message.TextContent)
	}
	if text == "" {
		return nil
	}

	chatID, triggerMessageID, err := a.awaitChatAndMessage(ctx, event.AccountID, message.Chat.WAChatJID, message.Message.WAMessageID)
	if err != nil {
		return err
	}

	chatHeader, err := a.chatRepository.GetChatHeader(ctx, chatID)
	if err != nil {
		return err
	}

	enabled := true
	rules, err := a.repository.ListRules(ctx, RuleListFilters{AccountID: event.AccountID, Enabled: &enabled})
	if err != nil {
		return err
	}
	if len(rules) == 0 {
		return nil
	}

	selected, ok := pickFirstMatchingRule(rules, chatHeader, chatID, text)
	if !ok {
		return nil
	}
	if selected.ReplyMode == ReplyModeManual {
		return nil
	}

	existingRunID, err := a.repository.GetRunIDByRuleAndTriggerMessage(ctx, selected.ID, triggerMessageID)
	if err == nil && existingRunID != "" {
		return nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	runID := ids.NewUUID()
	createdAt := a.now()

	recentMessages, _, err := a.chatRepository.ListMessages(ctx, chats.MessageListFilters{
		ChatID: chatID,
		Limit:  12,
	})
	if err != nil {
		return err
	}

	contextMessages := buildRunnerRecentMessages(recentMessages)

	inputContext, err := json.Marshal(map[string]any{
		"chat_title":        chatHeader.Title,
		"wa_chat_jid":       chatHeader.WAChatJID,
		"trigger_text":      text,
		"trigger_wa_id":     message.Message.WAMessageID,
		"rule_id":           selected.ID,
		"rule_name":         selected.Name,
		"rule_reply_mode":   selected.ReplyMode,
		"runner_configured": a.runner.Configured(),
		"received_at":       createdAt,
	})
	if err != nil {
		return fmt.Errorf("encode agent run context: %w", err)
	}

	if err := a.repository.CreateRun(ctx, AgentRun{
		ID:               runID,
		RuleID:           selected.ID,
		AccountID:        event.AccountID,
		ChatID:           chatID,
		TriggerMessageID: triggerMessageID,
		Status:           RunStatusGenerating,
		InputContext:     inputContext,
	}); err != nil {
		return err
	}

	if !a.runner.Configured() {
		completedAt := a.now()
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusFailed,
			BlockReason: stringPointer("agent runner is not configured (AGENT_RUNNER_BASE_URL)"),
			CompletedAt: &completedAt,
		})
	}

	recentAutoReplies := 0
	if selected.ReplyMode == ReplyModeAutoSend {
		// Safety cap: count only recent sends (24h window) so "thread cap" doesn't permanently brick a chat.
		count, err := a.repository.CountSentRunsSince(ctx, selected.ID, chatID, a.now().Add(-24*time.Hour))
		if err != nil {
			return err
		}
		recentAutoReplies = count
	}

	providerConfig, err := a.buildRunnerProvider(ctx, event.AccountID, selected)
	if err != nil {
		completedAt := a.now()
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusFailed,
			BlockReason: stringPointer(fmt.Sprintf("load agent settings failed: %v", err)),
			CompletedAt: &completedAt,
		})
	}
	resolvedPrompt := resolveRunnerPrompt(selected, providerConfig)

	runnerResp, err := a.runner.Run(ctx, RunnerRunRequest{
		RequestID:         runID,
		AccountID:         event.AccountID,
		ChatID:            chatID,
		TriggerMessageID:  triggerMessageID,
		ChatTitle:         chatHeader.Title,
		RecentAutoReplies: recentAutoReplies,
		Rule: RunnerRule{
			Name:                    selected.Name,
			Enabled:                 selected.Enabled,
			ReplyMode:               selected.ReplyMode,
			CooldownSeconds:         selected.CooldownSeconds,
			MaxAutoRepliesPerThread: selected.MaxAutoRepliesPerThread,
			TriggerFilter:           selected.TriggerFilter,
			BlacklistFilter:         selected.BlacklistFilter,
			PromptTemplate:          resolvedPrompt,
			KnowledgeBinding:        selected.KnowledgeBinding,
		},
		Message: RunnerMessage{Text: text},
		Context: RunnerContext{
			ChatTitle:      chatHeader.Title,
			RecentMessages: contextMessages,
		},
		Provider: providerConfig,
	})
	if err != nil {
		completedAt := a.now()
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusFailed,
			BlockReason: stringPointer(fmt.Sprintf("agent runner failed: %v", err)),
			CompletedAt: &completedAt,
		})
	}

	return a.applyRunnerDecision(ctx, runID, event.AccountID, chatHeader, selected, runnerResp)
}

func (a *Automation) applyRunnerDecision(
	ctx context.Context,
	runID string,
	accountID string,
	chatHeader chats.ChatHeader,
	rule AgentRule,
	runnerResp RunnerRunResponse,
) error {
	completedAt := a.now()

	draft := strings.TrimSpace(runnerResp.Draft)
	if draft == "" {
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusFailed,
			BlockReason: stringPointer("agent runner returned empty draft"),
			CompletedAt: &completedAt,
		})
	}

	switch runnerResp.Status {
	case "blocked":
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusBlocked,
			OutputDraft: stringPointer(draft),
			BlockReason: stringPointer(strings.Join(normalizeReasons(runnerResp.BlockReasons), "; ")),
			CompletedAt: &completedAt,
		})
	case "ready_for_review":
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusReadyForReview,
			OutputDraft: stringPointer(draft),
			CompletedAt: &completedAt,
		})
	case "dispatch_ready":
		// If auto-send is off globally, we still surface the draft for manual review.
		if !a.autoSendEnabled || rule.ReplyMode != ReplyModeAutoSend {
			return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
				Status:      RunStatusReadyForReview,
				OutputDraft: stringPointer(draft),
				CompletedAt: &completedAt,
			})
		}

		if rule.CooldownSeconds > 0 {
			lastSentAt, err := a.repository.GetLastSentRunAt(ctx, rule.ID, chatHeader.ID)
			if err != nil {
				return err
			}
			if lastSentAt != nil && completedAt.Sub(*lastSentAt) < time.Duration(rule.CooldownSeconds)*time.Second {
				return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
					Status:      RunStatusReadyForReview,
					OutputDraft: stringPointer(draft),
					CompletedAt: &completedAt,
				})
			}
		}

		sendResult, err := a.sessionRuntime.SendText(ctx, accountID, chatHeader.WAChatJID, draft)
		if err != nil {
			return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
				Status:      RunStatusFailed,
				OutputDraft: stringPointer(draft),
				BlockReason: stringPointer(fmt.Sprintf("auto-send failed: %v", err)),
				CompletedAt: &completedAt,
			})
		}

		sentMessageID, _ := a.awaitMessageID(ctx, accountID, sendResult.WAMessageID, 18, 150*time.Millisecond)
		var sentMessageIDPtr *string
		if sentMessageID != "" {
			sentMessageIDPtr = &sentMessageID
		}

		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:        RunStatusSent,
			OutputDraft:   stringPointer(draft),
			SentMessageID: sentMessageIDPtr,
			CompletedAt:   &completedAt,
		})
	default:
		return a.repository.UpdateRunStatus(ctx, runID, RunStatusUpdate{
			Status:      RunStatusFailed,
			OutputDraft: stringPointer(draft),
			BlockReason: stringPointer(fmt.Sprintf("unsupported runner status %q", runnerResp.Status)),
			CompletedAt: &completedAt,
		})
	}
}

func (a *Automation) awaitChatAndMessage(ctx context.Context, accountID, waChatJID, waMessageID string) (string, string, error) {
	trimmedChat := strings.TrimSpace(waChatJID)
	trimmedMessage := strings.TrimSpace(waMessageID)
	if trimmedChat == "" || trimmedMessage == "" {
		return "", "", fmt.Errorf("message payload missing wa ids")
	}

	chatID, err := a.awaitChatID(ctx, accountID, trimmedChat, 18, 150*time.Millisecond)
	if err != nil {
		return "", "", err
	}

	messageID, err := a.awaitMessageID(ctx, accountID, trimmedMessage, 18, 150*time.Millisecond)
	if err != nil {
		return "", "", err
	}

	return chatID, messageID, nil
}

func (a *Automation) awaitChatID(ctx context.Context, accountID, waChatJID string, attempts int, delay time.Duration) (string, error) {
	for i := 0; i < attempts; i++ {
		chatID, err := a.chatRepository.ResolveChatIDByWAJID(ctx, accountID, waChatJID)
		if err == nil {
			return chatID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if i == attempts-1 {
			return "", err
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
	}

	return "", fmt.Errorf("chat not found")
}

func (a *Automation) awaitMessageID(ctx context.Context, accountID, waMessageID string, attempts int, delay time.Duration) (string, error) {
	for i := 0; i < attempts; i++ {
		messageID, err := a.chatRepository.ResolveMessageIDByWAID(ctx, accountID, waMessageID)
		if err == nil {
			return messageID, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", err
		}
		if i == attempts-1 {
			return "", err
		}

		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(delay):
		}
	}

	return "", fmt.Errorf("message not found")
}

func pickFirstMatchingRule(rules []AgentRule, chatHeader chats.ChatHeader, chatID string, text string) (AgentRule, bool) {
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		if rule.Purpose != AgentPurposeReply {
			continue
		}
		if !ruleScopeMatches(rule, chatHeader, chatID) {
			continue
		}
		if !triggerMatches(rule.TriggerFilter, text) {
			continue
		}

		return rule, true
	}

	return AgentRule{}, false
}

type manualTrigger struct {
	ID          string
	WAMessageID string
	Text        string
}

func (a *Automation) resolveManualTrigger(
	ctx context.Context,
	chatID string,
	messageText *string,
	contextLimit int,
) (manualTrigger, []chats.MessageView, error) {
	recentMessages, _, err := a.chatRepository.ListMessages(ctx, chats.MessageListFilters{
		ChatID: chatID,
		Limit:  maxInt(contextLimit+8, 30),
	})
	if err != nil {
		return manualTrigger{}, nil, err
	}

	if len(recentMessages) == 0 {
		return manualTrigger{}, nil, fmt.Errorf("chat has no messages to use as agent context")
	}

	overrideText := ""
	if messageText != nil {
		overrideText = strings.TrimSpace(*messageText)
	}

	if overrideText != "" {
		if trigger, ok := latestTextTrigger(recentMessages, true); ok {
			trigger.Text = overrideText
			return trigger, recentMessages, nil
		}
		if trigger, ok := latestTextTrigger(recentMessages, false); ok {
			trigger.Text = overrideText
			return trigger, recentMessages, nil
		}
		return manualTrigger{}, nil, fmt.Errorf("chat has no text message to anchor agent run")
	}

	if trigger, ok := latestTextTrigger(recentMessages, true); ok {
		return trigger, recentMessages, nil
	}

	return manualTrigger{}, nil, fmt.Errorf("chat has no incoming text message to reply to")
}

func (a *Automation) resolveManualRule(
	ctx context.Context,
	chatHeader chats.ChatHeader,
	chatID string,
	triggerText string,
	agentID string,
	ruleID string,
) (AgentRule, error) {
	if strings.TrimSpace(ruleID) != "" {
		return AgentRule{}, fmt.Errorf("account-level agent rules are no longer used for manual drafts; configure the reply agent in admin backend")
	}

	systemConfig, err := a.resolveSystemAgentConfig(ctx, strings.TrimSpace(agentID), AgentPurposeReply)
	if err == nil && systemConfig.Enabled {
		return systemConfigRule(chatHeader.AccountID, systemConfig), nil
	}

	return AgentRule{}, fmt.Errorf("no reply agent is configured in admin backend")
}

func (a *Automation) resolveSystemAgentConfig(ctx context.Context, agentID string, purpose AgentPurpose) (SystemAgentConfig, error) {
	if strings.TrimSpace(agentID) != "" {
		config, err := a.repository.GetSystemConfigByID(ctx, agentID, purpose)
		if err != nil {
			return SystemAgentConfig{}, err
		}
		if !config.Enabled {
			return SystemAgentConfig{}, fmt.Errorf("selected agent is disabled")
		}
		return config, nil
	}

	return a.repository.GetSystemConfig(ctx, purpose)
}

func latestTextTrigger(messages []chats.MessageView, inboundOnly bool) (manualTrigger, bool) {
	for i := len(messages) - 1; i >= 0; i-- {
		message := messages[i]
		if inboundOnly && message.FromMe {
			continue
		}

		text := strings.TrimSpace(derefString(message.TextContent))
		if text == "" {
			continue
		}

		return manualTrigger{
			ID:          message.ID,
			WAMessageID: message.WAMessageID,
			Text:        text,
		}, true
	}

	return manualTrigger{}, false
}

func buildRunnerRecentMessages(messages []chats.MessageView) []RunnerRecentMessage {
	contextMessages := make([]RunnerRecentMessage, 0, len(messages))
	for _, item := range messages {
		preview := strings.TrimSpace(derefString(item.TextContent))
		if preview == "" && item.MessageType != "" {
			preview = fmt.Sprintf("[%s]", item.MessageType)
		}
		if preview == "" {
			continue
		}

		role := "customer"
		if item.FromMe {
			role = "agent"
		}

		contextMessages = append(contextMessages, RunnerRecentMessage{
			Role: role,
			Text: preview,
		})
	}

	return contextMessages
}

func normalizeContextMessageLimit(value int) int {
	if value <= 0 {
		return 12
	}
	if value > 50 {
		return 50
	}
	return value
}

func tailMessages(messages []chats.MessageView, limit int) []chats.MessageView {
	if limit <= 0 || len(messages) <= limit {
		return messages
	}
	return messages[len(messages)-limit:]
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}

func ruleScopeMatches(rule AgentRule, chatHeader chats.ChatHeader, chatID string) bool {
	if !ruleBelongsToAccount(rule, chatHeader.AccountID) {
		return false
	}
	if len(rule.ScopeFilter.ChatIDs) > 0 && !containsString(rule.ScopeFilter.ChatIDs, chatID) {
		return false
	}
	if len(rule.ScopeFilter.ChatTypes) > 0 && !containsString(rule.ScopeFilter.ChatTypes, string(chatHeader.ChatType)) {
		return false
	}

	return true
}

func ruleBelongsToAccount(rule AgentRule, accountID string) bool {
	trimmed := strings.TrimSpace(accountID)
	if trimmed == "" {
		return false
	}
	if rule.AccountID == trimmed {
		return true
	}
	return containsString(rule.AccountIDs, trimmed)
}

func triggerMatches(filter TriggerFilter, text string) bool {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return false
	}

	if filter.MinMessageChars > 0 && runeLen(trimmed) < filter.MinMessageChars {
		return false
	}

	keywords := normalizeStringList(filter.Keywords)
	if len(keywords) == 0 {
		return true
	}

	haystack := strings.ToLower(trimmed)

	switch normalizeMatchMode(filter.MatchMode) {
	case MatchModeAll:
		for _, kw := range keywords {
			if kw == "" {
				continue
			}
			if !strings.Contains(haystack, strings.ToLower(kw)) {
				return false
			}
		}
		return true
	default:
		for _, kw := range keywords {
			if kw == "" {
				continue
			}
			if strings.Contains(haystack, strings.ToLower(kw)) {
				return true
			}
		}
		return false
	}
}

func runeLen(value string) int {
	return len([]rune(value))
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if strings.TrimSpace(item) == target {
			return true
		}
	}
	return false
}

func normalizeReasons(reasons []string) []string {
	seen := make(map[string]struct{}, len(reasons))
	result := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		trimmed := strings.TrimSpace(reason)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func stringPointer(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	trimmed := strings.TrimSpace(value)
	return &trimmed
}

func (a *Automation) buildRunnerProvider(ctx context.Context, accountID string, rule AgentRule) (map[string]any, error) {
	if providerType := strings.TrimSpace(anyString(rule.ProviderConfig["type"])); providerType != "" {
		config := cloneProviderConfig(rule.ProviderConfig)
		config["type"] = strings.ToLower(providerType)
		config["prompt_template"] = strings.TrimSpace(resolveRunnerPrompt(rule, config))
		return config, nil
	}

	if rule.Purpose != "" {
		if systemConfig, err := a.repository.GetSystemConfig(ctx, rule.Purpose); err == nil && systemConfig.Enabled {
			config := cloneProviderConfig(systemConfig.ProviderConfig)
			if providerType := strings.TrimSpace(anyString(config["type"])); providerType != "" {
				config["type"] = strings.ToLower(providerType)
				config["prompt_template"] = strings.TrimSpace(resolveRunnerPrompt(rule, mapWithPromptFallback(config, systemConfig.PromptTemplate)))
				return config, nil
			}
		}
	}

	return nil, fmt.Errorf("admin agent provider config is required")
}

func systemConfigRule(accountID string, config SystemAgentConfig) AgentRule {
	replyMode := ReplyModeSuggest
	if config.Purpose == AgentPurposeTranslation {
		replyMode = ReplyModeManual
	}
	name := strings.TrimSpace(config.Name)
	if name == "" {
		name = "System Agent"
	}

	return AgentRule{
		ID:             config.ID,
		AccountID:      accountID,
		AccountIDs:     []string{accountID},
		Purpose:        config.Purpose,
		Name:           name,
		Enabled:        config.Enabled,
		ReplyMode:      replyMode,
		ScopeFilter:    ScopeFilter{},
		TriggerFilter:  TriggerFilter{MatchMode: MatchModeAny, IgnoreFromMe: true},
		PromptTemplate: strings.TrimSpace(config.PromptTemplate),
		ProviderConfig: cloneProviderConfig(config.ProviderConfig),
	}
}

func mapWithPromptFallback(config map[string]any, promptTemplate string) map[string]any {
	result := cloneProviderConfig(config)
	if strings.TrimSpace(anyString(result["prompt_template"])) == "" {
		result["prompt_template"] = strings.TrimSpace(promptTemplate)
	}

	return result
}

func resolveRunnerPrompt(rule AgentRule, providerConfig map[string]any) string {
	promptTemplate := strings.TrimSpace(rule.PromptTemplate)
	if promptTemplate != "" {
		return promptTemplate
	}

	configuredPrompt, _ := providerConfig["prompt_template"].(string)
	return strings.TrimSpace(configuredPrompt)
}

func cloneProviderConfig(config map[string]any) map[string]any {
	cloned := make(map[string]any, len(config))
	for key, value := range config {
		cloned[key] = value
	}
	return cloned
}

var _ = sql.ErrNoRows
var _ = json.RawMessage{}
