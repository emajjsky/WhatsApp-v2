package agents

import (
	"context"
	"log/slog"
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

const insertRuleSQLPattern = `(?s)INSERT INTO agent_rules\s*\(\s*id,\s*account_id,\s*purpose,\s*name,\s*enabled,\s*scope_filter,\s*trigger_filter,\s*reply_mode,\s*cooldown_seconds,\s*max_auto_replies_per_thread,\s*blacklist_filter,\s*prompt_template,\s*provider_config,\s*knowledge_binding\s*\)\s*VALUES\s*\(\$1,\s*\$2,\s*\$3,\s*\$4,\s*\$5,\s*\$6,\s*\$7,\s*\$8,\s*\$9,\s*\$10,\s*\$11,\s*\$12,\s*\$13,\s*\$14\)`

const getRuleByIDSQLPattern = `(?s)SELECT\s+ar\.id,.*COALESCE\(accounts\.account_ids, jsonb_build_array\(ar\.account_id::text\)\) AS account_ids.*FROM agent_rules ar.*WHERE ar\.id = \$1`

const listRulesSQLPattern = `(?s)SELECT\s+ar\.id,.*FROM agent_rules ar.*WHERE 1 = 1.*ar\.account_id = \$1.*ara_filter\.account_id = \$1.*ar\.enabled = \$2.*ORDER BY ar\.enabled DESC, ar\.updated_at DESC, ar\.id DESC`

func agentRuleRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id",
		"account_id",
		"purpose",
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
		"account_ids",
		"created_at",
		"updated_at",
	})
}

func expectSyncRuleAccounts(mock sqlmock.Sqlmock, accountID string) {
	mock.ExpectExec(`DELETE FROM agent_rule_accounts WHERE rule_id = \$1`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO agent_rule_accounts \(rule_id, account_id\) VALUES \(\$1, \$2\) ON CONFLICT DO NOTHING`).
		WithArgs(sqlmock.AnyArg(), accountID).
		WillReturnResult(sqlmock.NewResult(1, 1))
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

	mock.ExpectExec(insertRuleSQLPattern).
		WithArgs(
			sqlmock.AnyArg(),
			"acct-1",
			AgentPurposeReply,
			"Manual Rule",
			true,
			sqlmock.AnyArg(),
			sqlmock.AnyArg(),
			ReplyModeManual,
			300,
			0,
			sqlmock.AnyArg(),
			"Please handle manually.",
			sqlmock.AnyArg(),
			nil,
		).
		WillReturnResult(sqlmock.NewResult(1, 1))
	expectSyncRuleAccounts(mock, "acct-1")

	mock.ExpectQuery(getRuleByIDSQLPattern).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(agentRuleRows().AddRow(
			"rule-1",
			"acct-1",
			AgentPurposeReply,
			"Manual Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":[]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			ReplyModeManual,
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"Please handle manually.",
			[]byte(`{}`),
			nil,
			[]byte(`["acct-1"]`),
			fixedNow,
			fixedNow,
		))

	view, err := service.UpsertRule(context.Background(), UpsertRuleInput{
		AccountID:      "acct-1",
		Name:           "Manual Rule",
		Enabled:        true,
		ReplyMode:      ReplyModeManual,
		PromptTemplate: "Please handle manually.",
	})
	require.NoError(t, err)
	require.Equal(t, ReplyModeManual, view.ReplyMode)
	require.Equal(t, AgentPurposeReply, view.Purpose)
	require.Equal(t, []string{"acct-1"}, view.AccountIDs)
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

	mock.ExpectExec(insertRuleSQLPattern).
		WithArgs(
			sqlmock.AnyArg(),
			"acct-1",
			AgentPurposeReply,
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
	expectSyncRuleAccounts(mock, "acct-1")

	mock.ExpectQuery(getRuleByIDSQLPattern).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(agentRuleRows().AddRow(
			"rule-2",
			"acct-1",
			AgentPurposeReply,
			"Fallback Prompt Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":["direct"]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			ReplyModeSuggest,
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"",
			[]byte(`{}`),
			nil,
			[]byte(`["acct-1"]`),
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
	require.Equal(t, []string{"acct-1"}, view.AccountIDs)
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

	mock.ExpectQuery(`
SELECT id
FROM chats
WHERE account_id = \$1 AND wa_chat_jid = \$2`).
		WithArgs("acct-1", "chat-1@s.whatsapp.net").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("chat-local-1"))

	mock.ExpectQuery(`
SELECT id
FROM messages
WHERE account_id = \$1 AND wa_message_id = \$2`).
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
			"Customer A",
			nil,
			false,
			fixedNow,
		))

	mock.ExpectQuery(listRulesSQLPattern).
		WithArgs("acct-1", true).
		WillReturnRows(agentRuleRows().AddRow(
			"rule-1",
			"acct-1",
			AgentPurposeReply,
			"Manual Rule",
			true,
			[]byte(`{"chat_ids":[],"chat_types":["direct"]}`),
			[]byte(`{"keywords":[],"match_mode":"any","ignore_from_me":false,"min_message_chars":0}`),
			ReplyModeManual,
			300,
			0,
			[]byte(`{"blocked_keywords":[],"sensitive_topics":[]}`),
			"Please handle manually.",
			[]byte(`{}`),
			nil,
			[]byte(`["acct-1"]`),
			fixedNow,
			fixedNow,
		))

	text := "hello friends"
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

	prompt := resolveRunnerPrompt(AgentRule{PromptTemplate: "  use rule prompt  "}, map[string]any{
		"prompt_template": "use global prompt",
	})

	require.Equal(t, "use rule prompt", prompt)
}

func TestResolveRunnerPromptFallsBackToProviderPromptTemplate(t *testing.T) {
	t.Parallel()

	prompt := resolveRunnerPrompt(AgentRule{}, map[string]any{
		"prompt_template": "  use global prompt  ",
	})

	require.Equal(t, "use global prompt", prompt)
}
