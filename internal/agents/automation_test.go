package agents

import (
	"context"
	"log/slog"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"

	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/ingest"
	"whatsapp-agent-platform/internal/sessions"
)

type stubSessionRuntime struct {
	sendCalls int
}

func (s *stubSessionRuntime) Subscribe(buffer int) (<-chan sessions.Event, func()) {
	ch := make(chan sessions.Event)
	close(ch)
	return ch, func() {}
}

func (s *stubSessionRuntime) SendText(ctx context.Context, accountID, chatJID, text string) (sessions.SendResult, error) {
	s.sendCalls++
	return sessions.SendResult{}, nil
}

func TestServiceUpsertRuleAcceptsManualReplyMode(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repository, err := NewRepository(db)
	require.NoError(t, err)

	service, err := NewService(repository, nil)
	require.NoError(t, err)

	fixedNow := time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }

	mock.ExpectExec(regexp.QuoteMeta(`
INSERT INTO agent_rules (
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`)).
		WithArgs(
			sqlmock.AnyArg(),
			"acct-1",
			"Manual Rule",
			true,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			ReplyModeManual,
			300,
			0,
			sqlmock.AnyArg(),
			"请人工处理",
			sqlmock.AnyArg(),
			nil,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding,
    created_at,
    updated_at
FROM agent_rules
WHERE id = $1`)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"account_id",
			"name",
			"enabled",
			"scope_filter",
			"trigger_filter",
			"reply_mode",
			"cooldown_seconds",
			"max_auto_replies_per_thread",
			"blacklist_filter",
			"prompt_template",
			"provider_config",
			"knowledge_binding",
			"created_at",
			"updated_at",
		}).AddRow(
			"rule-1",
			"acct-1",
			"Manual Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":[]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			"manual",
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"请人工处理",
			[]byte(`{}`),
			nil,
			fixedNow,
			fixedNow,
		))

	view, err := service.UpsertRule(context.Background(), UpsertRuleInput{
		AccountID:      "acct-1",
		Name:           "Manual Rule",
		Enabled:        true,
		ReplyMode:      ReplyModeManual,
		PromptTemplate: "请人工处理",
	})
	require.NoError(t, err)
	require.Equal(t, ReplyModeManual, view.ReplyMode)
	require.Equal(t, 300, view.CooldownSeconds)
	require.Equal(t, "Manual Rule", view.Name)
	require.NotEmpty(t, view.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestServiceUpsertRuleAllowsEmptyPromptTemplateForSettingsFallback(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repository, err := NewRepository(db)
	require.NoError(t, err)

	service, err := NewService(repository, nil)
	require.NoError(t, err)

	fixedNow := time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return fixedNow }

	mock.ExpectExec(regexp.QuoteMeta(`
INSERT INTO agent_rules (
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`)).
		WithArgs(
			sqlmock.AnyArg(),
			"acct-1",
			"Fallback Prompt Rule",
			true,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			ReplyModeSuggest,
			300,
			0,
			sqlmock.AnyArg(),
			"",
			sqlmock.AnyArg(),
			nil,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding,
    created_at,
    updated_at
FROM agent_rules
WHERE id = $1`)).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"account_id",
			"name",
			"enabled",
			"scope_filter",
			"trigger_filter",
			"reply_mode",
			"cooldown_seconds",
			"max_auto_replies_per_thread",
			"blacklist_filter",
			"prompt_template",
			"provider_config",
			"knowledge_binding",
			"created_at",
			"updated_at",
		}).AddRow(
			"rule-2",
			"acct-1",
			"Fallback Prompt Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":["direct"]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			"suggest",
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"",
			[]byte(`{}`),
			nil,
			fixedNow,
			fixedNow,
		))

	view, err := service.UpsertRule(context.Background(), UpsertRuleInput{
		AccountID:      "acct-1",
		Name:           "Fallback Prompt Rule",
		Enabled:        true,
		ReplyMode:      ReplyModeSuggest,
		PromptTemplate: "   ",
	})
	require.NoError(t, err)
	require.Equal(t, "", view.PromptTemplate)
	require.Equal(t, ReplyModeSuggest, view.ReplyMode)
	require.NotEmpty(t, view.ID)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestAutomationHandleMessageEventSkipsRunCreationForManualRule(t *testing.T) {
	t.Parallel()

	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()

	repository, err := NewRepository(db)
	require.NoError(t, err)

	chatRepository, err := chats.NewRepository(db)
	require.NoError(t, err)

	sessionRuntime := &stubSessionRuntime{}
	automation, err := NewAutomation(repository, chatRepository, sessionRuntime, nil, false, slog.Default())
	require.NoError(t, err)

	fixedNow := time.Date(2026, 4, 24, 12, 0, 0, 0, time.UTC)

	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT id
FROM chats
WHERE account_id = $1 AND wa_chat_jid = $2`)).
		WithArgs("acct-1", "chat-1@s.whatsapp.net").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("chat-local-1"))

	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT id
FROM messages
WHERE account_id = $1 AND wa_message_id = $2`)).
		WithArgs("acct-1", "wa-msg-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("msg-local-1"))

	mock.ExpectQuery(`(?s)SELECT.*FROM chats c.*WHERE c\.id = \$1`).
		WithArgs("chat-local-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"account_id",
			"wa_chat_jid",
			"chat_type",
			"display_title",
			"participant_count",
			"archived",
			"last_message_at",
		}).AddRow(
			"chat-local-1",
			"acct-1",
			"chat-1@s.whatsapp.net",
			string(ingest.ChatTypeDirect),
			"客户A",
			nil,
			false,
			fixedNow,
		))

	mock.ExpectQuery(regexp.QuoteMeta(`
SELECT
    id,
    account_id,
    name,
    enabled,
    scope_filter,
    trigger_filter,
    reply_mode,
    cooldown_seconds,
    max_auto_replies_per_thread,
    blacklist_filter,
    prompt_template,
    provider_config,
    knowledge_binding,
    created_at,
    updated_at
FROM agent_rules
WHERE 1 = 1 AND account_id = $1 AND enabled = $2
ORDER BY enabled DESC, updated_at DESC, id DESC`)).
		WithArgs("acct-1", true).
		WillReturnRows(sqlmock.NewRows([]string{
			"id",
			"account_id",
			"name",
			"enabled",
			"scope_filter",
			"trigger_filter",
			"reply_mode",
			"cooldown_seconds",
			"max_auto_replies_per_thread",
			"blacklist_filter",
			"prompt_template",
			"provider_config",
			"knowledge_binding",
			"created_at",
			"updated_at",
		}).AddRow(
			"rule-1",
			"acct-1",
			"Manual Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":["direct"]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			"manual",
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"请人工处理",
			[]byte(`{}`),
			nil,
			fixedNow,
			fixedNow,
		))

	text := "你好，朋友们"
	event := sessions.Event{
		Type:      sessions.EventTypeMessageReceived,
		AccountID: "acct-1",
		EmittedAt: fixedNow,
		Message: &sessions.MessageEnvelope{
			Chat: ingest.ChatSnapshot{
				AccountID: "acct-1",
				WAChatJID: "chat-1@s.whatsapp.net",
				ChatType:  ingest.ChatTypeDirect,
			},
			Message: ingest.MessageInput{
				AccountID:   "acct-1",
				WAMessageID: "wa-msg-1",
				SenderJID:   "user@s.whatsapp.net",
				FromMe:      false,
				MessageType: ingest.MessageTypeText,
				TextContent: &text,
				SentAt:      fixedNow,
			},
			Payload: map[string]any{},
		},
	}

	err = automation.handleMessageEvent(context.Background(), event)
	require.NoError(t, err)
	require.Equal(t, 0, sessionRuntime.sendCalls)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestResolveRunnerPromptPrefersRulePromptTemplate(t *testing.T) {
	t.Parallel()

	prompt := resolveRunnerPrompt(AgentRule{PromptTemplate: "  使用规则提示词  "}, map[string]any{
		"prompt_template": "使用全局提示词",
	})

	require.Equal(t, "使用规则提示词", prompt)
}

func TestResolveRunnerPromptFallsBackToProviderPromptTemplate(t *testing.T) {
	t.Parallel()

	prompt := resolveRunnerPrompt(AgentRule{}, map[string]any{
		"prompt_template": "  使用全局提示词  ",
	})

	require.Equal(t, "使用全局提示词", prompt)
}
