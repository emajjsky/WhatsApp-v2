package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/platform"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load configuration", "error", err)
		os.Exit(1)
	}

	app, err := platform.New(cfg)
	if err != nil {
		slog.Error("failed to assemble application", "error", err)
		os.Exit(1)
	}

	if err := app.Run(ctx); err != nil {
		slog.Error("application terminated with error", "error", err)
		os.Exit(1)
	}
}
