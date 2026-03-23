package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/platform"
	"whatsapp-agent-platform/internal/sessions"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	logger, err := platform.NewLogger(cfg)
	if err != nil {
		slog.Error("failed to initialize logger", "error", err)
		os.Exit(1)
	}

	connector := sessions.NewPlaceholderConnector(logger)
	manager := sessions.NewManager(connector, nil, logger)

	logger.Info(
		"session gateway scaffold started",
		"service", cfg.AppName,
		"environment", cfg.Environment,
	)

	<-ctx.Done()

	logger.Info("session gateway stopped", "reason", "signal received", "manager", manager != nil)
}
