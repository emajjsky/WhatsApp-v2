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

func (a *Automation) handleMessageEvent(ctx context.Context, event sessions.Event) error {
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

	contextMessages := make([]RunnerRecentMessage, 0, len(recentMessages))
	for _, item := range recentMessages {
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
			PromptTemplate:          selected.PromptTemplate,
			KnowledgeBinding:        selected.KnowledgeBinding,
		},
		Message: RunnerMessage{Text: text},
		Context: RunnerContext{
			ChatTitle:      chatHeader.Title,
			RecentMessages: contextMessages,
		},
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
		if len(rule.ScopeFilter.ChatIDs) > 0 && !containsString(rule.ScopeFilter.ChatIDs, chatID) {
			continue
		}
		if len(rule.ScopeFilter.ChatTypes) > 0 && !containsString(rule.ScopeFilter.ChatTypes, string(chatHeader.ChatType)) {
			continue
		}
		if !triggerMatches(rule.TriggerFilter, text) {
			continue
		}

		return rule, true
	}

	return AgentRule{}, false
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

var _ = sql.ErrNoRows
var _ = json.RawMessage{}
