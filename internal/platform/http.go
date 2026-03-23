package platform

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"whatsapp-agent-platform/internal/config"
)

type healthResponse struct {
	Service     string    `json:"service"`
	Environment string    `json:"environment"`
	Status      string    `json:"status"`
	Timestamp   time.Time `json:"timestamp"`
}

func NewRouter(cfg config.Config, logger *slog.Logger, deps RouteDependencies) http.Handler {
	mux := http.NewServeMux()
	registerRoutes(mux, cfg, logger, deps)

	return requestLoggingMiddleware(logger, mux)
}

func NewHTTPServer(cfg config.Config, handler http.Handler, _ *slog.Logger) *http.Server {
	return &http.Server{
		Addr:              cfg.HTTP.Address(),
		Handler:           handler,
		ReadHeaderTimeout: cfg.HTTP.ReadTimeout,
		ReadTimeout:       cfg.HTTP.ReadTimeout,
		WriteTimeout:      cfg.HTTP.WriteTimeout,
		IdleTimeout:       cfg.HTTP.IdleTimeout,
	}
}

func requestLoggingMiddleware(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)

		logger.Debug(
			"http request completed",
			"method", r.Method,
			"path", r.URL.Path,
			"duration", time.Since(start).String(),
			"remote_addr", r.RemoteAddr,
		)
	})
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	body, err := json.Marshal(payload)
	if err != nil {
		http.Error(w, http.StatusText(http.StatusInternalServerError), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}
