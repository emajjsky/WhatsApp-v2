package platform

import (
	"fmt"
	"log/slog"
	"os"
	"strings"

	"whatsapp-agent-platform/internal/config"
)

func NewLogger(cfg config.Config) (*slog.Logger, error) {
	level, err := parseLogLevel(cfg.Logging.Level)
	if err != nil {
		return nil, err
	}

	options := &slog.HandlerOptions{
		Level:     level,
		AddSource: cfg.Environment != "production",
	}

	var handler slog.Handler
	switch strings.ToLower(cfg.Logging.Format) {
	case "json":
		handler = slog.NewJSONHandler(os.Stdout, options)
	case "text":
		handler = slog.NewTextHandler(os.Stdout, options)
	default:
		return nil, fmt.Errorf("unsupported log format %q", cfg.Logging.Format)
	}

	return slog.New(handler).With(
		"service", cfg.AppName,
		"environment", cfg.Environment,
	), nil
}

func parseLogLevel(level string) (slog.Level, error) {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return slog.LevelDebug, nil
	case "info":
		return slog.LevelInfo, nil
	case "warn":
		return slog.LevelWarn, nil
	case "error":
		return slog.LevelError, nil
	default:
		return 0, fmt.Errorf("unsupported log level %q", level)
	}
}
