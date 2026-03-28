package exports

import (
	"fmt"
	"path/filepath"
	"strings"

	"whatsapp-agent-platform/internal/chats"
)

func RenderMarkdown(document ExportDocument) ([]byte, error) {
	var builder strings.Builder

	builder.WriteString("# WhatsApp 导出包\n\n")
	builder.WriteString(fmt.Sprintf("- Generated at: %s\n", document.GeneratedAt.Format("2006-01-02 15:04:05")))
	builder.WriteString(fmt.Sprintf("- Scope type: %s\n", document.ScopeType))
	builder.WriteString(fmt.Sprintf("- Accounts: %d\n", len(document.Selection.AccountIDs)))
	builder.WriteString(fmt.Sprintf("- Conversations: %d\n", document.TotalChats))
	builder.WriteString(fmt.Sprintf("- Messages: %d\n", document.TotalMessages))
	builder.WriteString(fmt.Sprintf("- Date range: %s\n\n", formatSelectionDateRange(document.Selection)))

	for _, conversation := range document.Conversations {
		builder.WriteString(fmt.Sprintf("## %s\n\n", conversation.ChatTitle))
		builder.WriteString(fmt.Sprintf("- Chat JID: `%s`\n", conversation.Chat.WAChatJID))
		builder.WriteString(fmt.Sprintf("- Chat type: `%s`\n", conversation.Chat.ChatType))
		builder.WriteString(fmt.Sprintf("- Message count: %d\n\n", conversation.MessageCount))

		if len(conversation.Messages) == 0 {
			builder.WriteString("_No messages matched this selection._\n\n")
			continue
		}

		for _, message := range conversation.Messages {
			builder.WriteString(renderMarkdownMessage(message))
			builder.WriteString("\n")
		}
	}

	return []byte(builder.String()), nil
}

func renderMarkdownMessage(message chats.MessageView) string {
	sender := message.SenderJID
	if message.FromMe {
		sender = "Sent from device"
	}

	text := message.TextContent
	if text == nil || *text == "" {
		fallback := fallbackExportText(string(message.MessageType))
		text = &fallback
	}

	line := fmt.Sprintf("### %s · %s\n\n%s\n", sender, message.SentAt.Format("2006-01-02 15:04:05"), *text)

	if len(message.Media) > 0 {
		line += "\n#### Media\n"
		for _, media := range message.Media {
			label := mediaLabel(media.FileName, media.StorageKey)
			if media.StorageKey != nil && strings.TrimSpace(*media.StorageKey) != "" {
				href := filepath.ToSlash(*media.StorageKey)
				if strings.HasPrefix(href, "data/") {
					href = "../" + strings.TrimPrefix(href, "data/")
				}
				line += fmt.Sprintf("- %s [%s](%s)\n", media.MediaType, label, href)
			} else {
				line += fmt.Sprintf("- %s %s\n", media.MediaType, label)
			}
		}
	}

	return line
}
