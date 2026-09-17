package chats

import "testing"

func TestParsePollDetails(t *testing.T) {
	allowMultiple := true
	tests := []struct {
		name          string
		rawPayload    string
		textContent   *string
		question      string
		options       []string
		allowMultiple bool
	}{
		{
			name:          "outgoing payload",
			rawPayload:    `{"poll_question":"午饭吃什么？","poll_options":["面条","米饭"],"allow_multiple":true}`,
			question:      "午饭吃什么？",
			options:       []string{"面条", "米饭"},
			allowMultiple: allowMultiple,
		},
		{
			name:       "incoming whatsmeow payload",
			rawPayload: `{"raw_proto":{"pollCreationMessage":{"name":"选择时间","options":[{"optionName":"上午"},{"optionName":"下午"}],"selectableOptionsCount":1}}}`,
			question:   "选择时间",
			options:    []string{"上午", "下午"},
		},
		{
			name:        "legacy text fallback",
			textContent: stringPointerForTest("最喜欢哪一个？\n- A\n- B"),
			question:    "最喜欢哪一个？",
			options:     []string{"A", "B"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			details := parsePollDetails([]byte(test.rawPayload), test.textContent)
			if details.Question != test.question {
				t.Fatalf("question = %q, want %q", details.Question, test.question)
			}
			if details.AllowMultiple != test.allowMultiple {
				t.Fatalf("allow_multiple = %v, want %v", details.AllowMultiple, test.allowMultiple)
			}
			if len(details.Options) != len(test.options) {
				t.Fatalf("options = %#v, want %#v", details.Options, test.options)
			}
			for index := range test.options {
				if details.Options[index] != test.options[index] {
					t.Fatalf("options = %#v, want %#v", details.Options, test.options)
				}
			}
		})
	}
}

func stringPointerForTest(value string) *string {
	return &value
}
