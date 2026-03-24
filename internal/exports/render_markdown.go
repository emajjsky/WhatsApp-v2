package exports

import (
	"fmt"
	"path/filepath"
	"strings"

	"whatsapp-agent-platform/internal/chats"
)

func RenderMarkdown(document ExportDocument) ([]byte, error) {
	var builder strings.Builder

	builder.WriteString(fmt.Sprintf("# %s\n\n", document.ChatTitle))
	builder.WriteString(fmt.Sprintf("- Generated at: %s\n", document.GeneratedAt.Format("2006-01-02 15:04:05")))
	builder.WriteString(fmt.Sprintf("- Chat JID: `%s`\n", document.Chat.WAChatJID))
	builder.WriteString(fmt.Sprintf("- Message count: %d\n\n", len(document.Messages)))

	for _, message := range document.Messages {
		builder.WriteString(renderMarkdownMessage(message))
		builder.WriteString("\n")
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

	line := fmt.Sprintf("## %s · %s\n\n%s\n", sender, message.SentAt.Format("2006-01-02 15:04:05"), *text)

	if len(message.Media) > 0 {
		line += "\n### Media\n"
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
