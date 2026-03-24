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
}).Parse(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{{ .ChatTitle }}</title>
    <style>
      body { font-family: "Noto Sans SC", sans-serif; background: #f4efe7; color: #213038; margin: 0; padding: 32px; }
      .shell { max-width: 920px; margin: 0 auto; }
      .hero, .msg { background: rgba(255,255,255,.88); border: 1px solid rgba(33,48,56,.12); border-radius: 20px; box-shadow: 0 18px 42px rgba(33,48,56,.08); }
      .hero { padding: 24px; margin-bottom: 20px; }
      .hero h1 { margin: 0 0 10px; font-size: 32px; }
      .meta { color: #607178; line-height: 1.8; }
      .timeline { display: grid; gap: 14px; }
      .msg { padding: 18px; }
      .msg h3 { margin: 0 0 8px; font-size: 15px; color: #607178; }
      .msg p { margin: 0; line-height: 1.7; }
      .media { margin-top: 12px; display: grid; gap: 12px; }
      .media-card { margin: 0; display: grid; gap: 8px; padding: 10px; border-radius: 16px; border: 1px solid rgba(33,48,56,.1); background: rgba(255,255,255,.72); }
      .media-card img, .media-card video { max-width: min(100%, 320px); max-height: 320px; object-fit: contain; border-radius: 12px; background: #f7faf9; }
      .media-card img.sticker { width: min(180px, 100%); max-height: 180px; }
      .media-card audio { width: min(100%, 320px); }
      .chip { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: rgba(15,125,134,.1); color: #125b63; font-size: 13px; }
      .media-link { display: inline-flex; width: fit-content; padding: 8px 12px; border-radius: 999px; background: rgba(15,125,134,.1); color: #125b63; text-decoration: none; }
    </style>
  </head>
  <body>
    <main class="shell">
      <section class="hero">
        <h1>{{ .ChatTitle }}</h1>
        <div class="meta">
          <div>Generated at: {{ .GeneratedAt.Format "2006-01-02 15:04:05" }}</div>
          <div>Chat JID: {{ .Chat.WAChatJID }}</div>
          <div>Message count: {{ len .Messages }}</div>
        </div>
      </section>
      <section class="timeline">
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
      </section>
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
