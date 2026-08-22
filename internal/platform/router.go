package platform

import (
	"log/slog"
	"net/http"
	"time"

	"whatsapp-agent-platform/internal/accounts"
	"whatsapp-agent-platform/internal/agents"
	"whatsapp-agent-platform/internal/audit"
	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/exports"
	"whatsapp-agent-platform/internal/health"
	"whatsapp-agent-platform/internal/proxies"
	"whatsapp-agent-platform/internal/scripts"
)

type RouteDependencies struct {
	AccountHandler *accounts.Handler
	AuthHandler    *auth.Handler
	AuthService    *auth.Service
	AuditHandler   *audit.Handler
	ChatHandler    *chats.Handler
	ExportHandler  *exports.Handler
	AgentHandler   *agents.Handler
	ScriptHandler  *scripts.Handler
	ProxyHandler   *proxies.Handler
	LiveHandler    interface{ RegisterRoutes(mux *http.ServeMux) }
	HealthService  *health.Service
}

func registerRoutes(mux *http.ServeMux, cfg config.Config, _ *slog.Logger, deps RouteDependencies) {
	registerBaseRoutes(mux, cfg)

	if deps.AuthHandler != nil {
		deps.AuthHandler.RegisterRoutes(mux)
	}
	if deps.AccountHandler != nil {
		deps.AccountHandler.RegisterRoutes(mux)
	}
	if deps.ChatHandler != nil {
		deps.ChatHandler.RegisterRoutes(mux)
	}
	if deps.AuditHandler != nil {
		deps.AuditHandler.RegisterRoutes(mux)
	}
	if deps.ExportHandler != nil {
		deps.ExportHandler.RegisterRoutes(mux)
	}
	if deps.AgentHandler != nil {
		deps.AgentHandler.RegisterRoutes(mux)
	}
	if deps.ScriptHandler != nil {
		deps.ScriptHandler.RegisterRoutes(mux)
	}
	if deps.ProxyHandler != nil {
		deps.ProxyHandler.RegisterRoutes(mux)
	}
	if deps.LiveHandler != nil {
		deps.LiveHandler.RegisterRoutes(mux)
	}
	if deps.HealthService != nil {
		mux.HandleFunc("/api/system/health", func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, http.StatusText(http.StatusMethodNotAllowed), http.StatusMethodNotAllowed)
				return
			}

			writeJSON(w, http.StatusOK, deps.HealthService.Summary(r.Context()))
		})
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
