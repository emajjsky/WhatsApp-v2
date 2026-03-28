package exports

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"html/template"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

var exportHTMLTemplate = template.Must(template.New("export").Funcs(template.FuncMap{
	"fallbackText":      fallbackExportText,
	"mediaLabel":        mediaLabel,
	"inlineMediaSrc":    inlineMediaSrc,
	"exportMediaHref":   exportMediaHref,
	"isRenderableImage": isRenderableImage,
	"isRenderableVideo": isRenderableVideo,
	"isRenderableAudio": isRenderableAudio,
	"dateRangeLabel":    formatSelectionDateRange,
}).Parse(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>WhatsApp 导出包</title>
    <style>
      body { font-family: "Noto Sans SC", sans-serif; background: #f3f4f6; color: #1f2a33; margin: 0; padding: 32px; }
      .shell { max-width: 1080px; margin: 0 auto; display: grid; gap: 18px; }
      .hero, .conversation, .msg { background: rgba(255,255,255,.94); border: 1px solid rgba(31,42,51,.1); border-radius: 22px; box-shadow: 0 18px 42px rgba(31,42,51,.08); }
      .hero { padding: 26px; }
      .hero h1 { margin: 0 0 12px; font-size: 34px; }
      .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
      .meta-card { padding: 14px 16px; border-radius: 16px; background: #f7fafb; border: 1px solid rgba(31,42,51,.08); }
      .meta-card span { display: block; font-size: 12px; color: #64727d; margin-bottom: 4px; }
      .meta-card strong { font-size: 22px; }
      .conversation { padding: 22px; }
      .conversation-head { display: flex; justify-content: space-between; gap: 16px; align-items: start; margin-bottom: 16px; }
      .conversation-head h2 { margin: 0 0 8px; font-size: 26px; }
      .conversation-meta { color: #64727d; line-height: 1.75; }
      .timeline { display: grid; gap: 12px; }
      .msg { padding: 16px 18px; }
      .msg h3 { margin: 0 0 8px; font-size: 14px; color: #64727d; }
      .msg p { margin: 0; line-height: 1.7; }
      .empty { padding: 18px; border-radius: 16px; background: #f8fafb; color: #64727d; border: 1px dashed rgba(31,42,51,.12); }
      .media { margin-top: 12px; display: grid; gap: 12px; }
      .media-card { margin: 0; display: grid; gap: 8px; padding: 10px; border-radius: 16px; border: 1px solid rgba(31,42,51,.1); background: rgba(255,255,255,.88); }
      .media-card img, .media-card video { max-width: min(100%, 320px); max-height: 320px; object-fit: contain; border-radius: 12px; background: #f7faf9; }
      .media-card img.sticker { width: min(180px, 100%); max-height: 180px; }
      .media-card audio { width: min(100%, 320px); }
      .chip { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: rgba(15,125,134,.1); color: #125b63; font-size: 12px; }
      .media-link { display: inline-flex; width: fit-content; padding: 8px 12px; border-radius: 999px; background: rgba(15,125,134,.1); color: #125b63; text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <h1>WhatsApp 导出包</h1>
        <div class="meta-grid">
          <article class="meta-card">
            <span>生成时间</span>
            <strong>{{ .GeneratedAt.Format "2006-01-02 15:04:05" }}</strong>
          </article>
          <article class="meta-card">
            <span>账号数量</span>
            <strong>{{ len .Selection.AccountIDs }}</strong>
          </article>
          <article class="meta-card">
            <span>会话数量</span>
            <strong>{{ .TotalChats }}</strong>
          </article>
          <article class="meta-card">
            <span>消息总数</span>
            <strong>{{ .TotalMessages }}</strong>
          </article>
          <article class="meta-card">
            <span>时间范围</span>
            <strong>{{ dateRangeLabel .Selection }}</strong>
          </article>
        </div>
      </section>

      {{ range .Conversations }}
        <section class="conversation">
          <div class="conversation-head">
            <div>
              <h2>{{ .ChatTitle }}</h2>
              <div class="conversation-meta">
                <div>Chat JID: {{ .Chat.WAChatJID }}</div>
                <div>Chat type: {{ .Chat.ChatType }}</div>
              </div>
            </div>
            <span class="chip">{{ .MessageCount }} 条消息</span>
          </div>

          {{ if .Messages }}
            <div class="timeline">
              {{ range .Messages }}
                <article class="msg">
                  <h3>{{ if .FromMe }}Sent from device{{ else }}{{ .SenderJID }}{{ end }} · {{ .SentAt.Format "2006-01-02 15:04:05" }}</h3>
                  <p>{{ if .TextContent }}{{ .TextContent }}{{ else }}{{ fallbackText .MessageType }}{{ end }}</p>
                  {{ if .Media }}
                    <div class="media">
                      {{ range .Media }}
                        {{ if and .StorageKey (isRenderableImage .MediaType .DownloadStatus) }}
                          <figure class="media-card">
                            <img class="{{ if eq (printf "%v" .MediaType) "sticker" }}sticker{{ end }}" src="{{ inlineMediaSrc .StorageKey .MIMEType }}" alt="{{ mediaLabel .FileName .StorageKey }}" />
                            <figcaption>{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</figcaption>
                          </figure>
                        {{ else if and .StorageKey (isRenderableVideo .MediaType .DownloadStatus) }}
                          <figure class="media-card">
                            <video controls preload="metadata" src="{{ inlineMediaSrc .StorageKey .MIMEType }}"></video>
                            <figcaption>{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</figcaption>
                          </figure>
                        {{ else if and .StorageKey (isRenderableAudio .MediaType .DownloadStatus) }}
                          <figure class="media-card">
                            <audio controls preload="metadata" src="{{ inlineMediaSrc .StorageKey .MIMEType }}"></audio>
                            <figcaption>{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</figcaption>
                          </figure>
                        {{ else if .StorageKey }}
                          <a class="media-link" href="{{ exportMediaHref .StorageKey .MIMEType }}" target="_blank" rel="noreferrer">{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</a>
                        {{ else }}
                          <span class="chip">{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</span>
                        {{ end }}
                      {{ end }}
                    </div>
                  {{ end }}
                </article>
              {{ end }}
            </div>
          {{ else }}
            <div class="empty">这个会话在当前筛选时间内没有命中消息。</div>
          {{ end }}
        </section>
      {{ end }}
    </main>
  </body>
</html>`))

func RenderHTML(document ExportDocument) ([]byte, error) {
	var buffer bytes.Buffer
	if err := exportHTMLTemplate.Execute(&buffer, document); err != nil {
		return nil, err
	}

	return buffer.Bytes(), nil
}

func exportMediaHref(storageKey *string, mimeType *string) template.URL {
	if inline := inlineMediaSrc(storageKey, mimeType); inline != "" {
		return inline
	}
	if storageKey == nil || strings.TrimSpace(*storageKey) == "" {
		return template.URL("")
	}

	path := filepath.ToSlash(*storageKey)
	if strings.HasPrefix(path, "data/") {
		return template.URL("../" + strings.TrimPrefix(path, "data/"))
	}

	return template.URL(path)
}

func inlineMediaSrc(storageKey *string, mimeType *string) template.URL {
	if storageKey == nil || strings.TrimSpace(*storageKey) == "" {
		return template.URL("")
	}

	data, err := os.ReadFile(filepath.Clean(*storageKey))
	if err != nil || len(data) == 0 {
		return template.URL("")
	}

	contentType := ""
	if mimeType != nil && strings.TrimSpace(*mimeType) != "" {
		contentType = strings.TrimSpace(*mimeType)
	}
	if contentType == "" {
		contentType = mime.TypeByExtension(filepath.Ext(*storageKey))
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	return template.URL(fmt.Sprintf("data:%s;base64,%s", contentType, base64.StdEncoding.EncodeToString(data)))
}

func isRenderableImage(mediaType any, status any) bool {
	media := strings.ToLower(strings.TrimSpace(fmt.Sprint(mediaType)))
	return (media == "image" || media == "sticker") && stringifyStatus(status) == "ready"
}

func isRenderableVideo(mediaType any, status any) bool {
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(mediaType))) == "video" && stringifyStatus(status) == "ready"
}

func isRenderableAudio(mediaType any, status any) bool {
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(mediaType))) == "audio" && stringifyStatus(status) == "ready"
}

func stringifyStatus(value any) string {
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
}
