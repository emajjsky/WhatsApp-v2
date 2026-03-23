package exports

import (
	"bytes"
	"html/template"
)

var exportHTMLTemplate = template.Must(template.New("export").Funcs(template.FuncMap{
	"fallbackText": fallbackExportText,
	"mediaLabel":   mediaLabel,
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
      .media { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
      .chip { display: inline-flex; padding: 6px 10px; border-radius: 999px; background: rgba(15,125,134,.1); color: #125b63; font-size: 13px; }
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
                  <span class="chip">{{ .MediaType }} {{ mediaLabel .FileName .StorageKey }}</span>
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
