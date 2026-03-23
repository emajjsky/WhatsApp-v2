package platform

import (
	"log/slog"
	"net/http"
	"time"

	"whatsapp-agent-platform/internal/accounts"
	"whatsapp-agent-platform/internal/agents"
	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/exports"
)

type RouteDependencies struct {
	AccountHandler *accounts.Handler
	ChatHandler    *chats.Handler
	ExportHandler  *exports.Handler
	AgentHandler   *agents.Handler
}

func registerRoutes(mux *http.ServeMux, cfg config.Config, _ *slog.Logger, deps RouteDependencies) {
	registerBaseRoutes(mux, cfg)

	if deps.AccountHandler != nil {
		deps.AccountHandler.RegisterRoutes(mux)
	}
	if deps.ChatHandler != nil {
		deps.ChatHandler.RegisterRoutes(mux)
	}
	if deps.ExportHandler != nil {
		deps.ExportHandler.RegisterRoutes(mux)
	}
	if deps.AgentHandler != nil {
		deps.AgentHandler.RegisterRoutes(mux)
	}
}

func registerBaseRoutes(mux *http.ServeMux, cfg config.Config) {
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{
			"service": cfg.AppName,
			"message": "api server is running",
		})
	})

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, healthResponse{
			Service:     cfg.AppName,
			Environment: cfg.Environment,
			Status:      "ok",
			Timestamp:   time.Now().UTC(),
		})
	})
}
