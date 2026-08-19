package chats

import (
	"context"
	"strings"
	"testing"
)

func TestVisibleMessageConditionExcludesInternalProtocolMessages(t *testing.T) {
	condition := visibleMessageCondition("m")
	if condition != `(m.message_type <> 'system' OR COALESCE(m.text_content, '') NOT LIKE 'protocol:%')` {
		t.Fatalf("visible message condition = %q", condition)
	}
}

func TestBuildChatListWhereFiltersProtocolOnlyChatsAndSearchMessages(t *testing.T) {
	whereClause, args := buildChatListWhere(context.Background(), ChatListFilters{Query: "hello"})

	if len(args) != 1 || args[0] != "%hello%" {
		t.Fatalf("args = %#v, want one search argument", args)
	}
	if strings.Contains(whereClause, "%!") {
		t.Fatalf("where clause contains a formatting error: %s", whereClause)
	}
	if !strings.Contains(whereClause, visibleMessageCondition("sm")) {
		t.Fatalf("search condition does not filter protocol messages: %s", whereClause)
	}
	if !strings.Contains(whereClause, visibleMessageCondition("vm")) {
		t.Fatalf("chat visibility condition does not filter protocol-only chats: %s", whereClause)
	}
}
