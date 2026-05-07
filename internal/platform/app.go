package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"

	"whatsapp-agent-platform/internal/accounts"
	"whatsapp-agent-platform/internal/agents"
	"whatsapp-agent-platform/internal/audit"
	"whatsapp-agent-platform/internal/auth"
	"whatsapp-agent-platform/internal/chats"
	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/exports"
	"whatsapp-agent-platform/internal/health"
	"whatsapp-agent-platform/internal/ingest"
	"whatsapp-agent-platform/internal/scripts"
	"whatsapp-agent-platform/internal/sessions"
	"whatsapp-agent-platform/internal/storage"
)

type App struct {
	cfg             config.Config
	logger          *slog.Logger
	router          http.Handler
	httpServer      *http.Server
	database        *storage.Postgres
	agentAutomation *agents.Automation
}

func New(cfg config.Config) (*App, error) {
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	logger, err := NewLogger(cfg)
	if err != nil {
		return nil, err
	}

	var (
		database        *storage.Postgres
		sessionManager  *sessions.Manager
		eventBridge     *sessions.EventBridge
		deps            RouteDependencies
		agentAutomation *agents.Automation
		authService     *auth.Service
		bootstrapAdmin  auth.User
	)

	if cfg.Database.DSN != "" {
		database, err = storage.Open(context.Background(), cfg.Database.Driver, cfg.Database.DSN)
		if err != nil {
			return nil, err
		}

		if cfg.Database.AutoMigrate {
			migrator := storage.NewMigrator(cfg.Database.MigrationsDir)
			if err := migrator.Apply(context.Background(), database.DB()); err != nil {
				_ = database.Close()
				return nil, err
			}
		}

		authRepo, err := auth.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		authService, err = auth.NewServiceWithCloud(authRepo, auth.ServiceConfig{
			CookieName:             cfg.Auth.CookieName,
			SessionTTL:             cfg.Auth.SessionTTL,
			RegistrationEnabled:    cfg.Auth.RegistrationEnabled,
			BootstrapAdminEmail:    cfg.Auth.BootstrapAdminEmail,
			BootstrapAdminPassword: cfg.Auth.BootstrapAdminPassword,
			BootstrapAdminName:     cfg.Auth.BootstrapAdminName,
			SecureCookie:           cfg.Auth.SecureCookie,
		}, auth.NewCloudClient(cfg.Integrations.CloudAuthBaseURL), logger)
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		bootstrapAdmin, err = authService.Bootstrap(context.Background())
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		logger.Info("auth bootstrap completed", "admin_email", bootstrapAdmin.Email)

		authHandler, err := auth.NewHandler(authService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		accountRepo, err := accounts.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		credentialRepo, err := sessions.NewCredentialRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		credentialStore, err := sessions.NewCredentialStoreAdapter(credentialRepo)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		realConnector, err := sessions.NewWhatsmeowConnector(
			database.DB(),
			credentialStore,
			accountPhoneLookup{repository: accountRepo},
			cfg.Integrations.WhatsAppProxyURL,
			logger,
		)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		sessionManager = sessions.NewManager(
			realConnector,
			credentialStore,
			logger,
		)

		ingestRepo, err := ingest.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		ingestService, err := ingest.NewService(ingestRepo, nil)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		eventBridge = sessions.NewEventBridge(ingestService, accountRepo, logger)
		sessionManager.SetEventBridge(eventBridge)

		accountService, err := accounts.NewService(accountRepo, sessionManager)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		accountHandler, err := accounts.NewHandler(accountService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		chatRepo, err := chats.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		chatService, err := chats.NewService(chatRepo, sessionManager)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		chatHandler, err := chats.NewHandler(chatService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		exportRepo, err := exports.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		exportService, err := exports.NewService(exportRepo, chatRepo, "data/exports", logger)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		exportHandler, err := exports.NewHandler(exportService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		agentRepo, err := agents.NewRepository(database.DB())
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		agentService, err := agents.NewService(agentRepo, accountRepo)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		agentHandler, err := agents.NewHandler(agentService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		if cfg.Integrations.CloudAuthBaseURL != "" {
			agentHandler.SetCloudProxy(agents.NewCloudProxy(
				cfg.Integrations.CloudAuthBaseURL,
				authService,
				agentRepo,
				chatRepo,
			))
		}

		runnerClient := agents.NewRunnerClient(cfg.Integrations.AgentRunnerBaseURL)
		agentAutomation, err = agents.NewAutomation(
			agentRepo,
			chatRepo,
			sessionManager,
			runnerClient,
			cfg.Integrations.AgentAutoSendEnabled,
			logger,
		)
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		agentHandler.SetAutomation(agentAutomation)

		auditService, err := audit.NewService(database.DB(), logger)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		auditHandler, err := audit.NewHandler(auditService)
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		accountHandler.SetAuditRecorder(auditService)
		exportHandler.SetAuditRecorder(auditService)
		agentHandler.SetAuditRecorder(auditService)

		liveHandler, err := sessions.NewLiveHandler(eventBridge, accountAccessChecker{repository: accountRepo})
		if err != nil {
			_ = database.Close()
			return nil, err
		}

		existingAccounts, err := accountRepo.List(context.Background())
		if err != nil {
			_ = database.Close()
			return nil, err
		}
		for _, account := range existingAccounts {
			if restoreErr := sessionManager.Restore(context.Background(), account.ID); restoreErr != nil {
				logger.Warn("failed to restore whatsapp session", "account_id", account.ID, "error", restoreErr)
			}
		}

		deps.AccountHandler = accountHandler
		deps.AuthHandler = authHandler
		deps.AuthService = authService
		deps.AuditHandler = auditHandler
		deps.ChatHandler = chatHandler
		deps.ExportHandler = exportHandler
		deps.AgentHandler = agentHandler
		deps.LiveHandler = liveHandler
	} else {
		logger.Warn("database is not configured; account, chat, export, and agent APIs are disabled")
	}

	scriptService, err := scripts.NewService("data/scripts", logger)
	if err != nil {
		if database != nil {
			_ = database.Close()
		}
		return nil, err
	}
	if bootstrapAdmin.ID != "" {
		if err := scriptService.AssignOrphanDocuments(context.Background(), bootstrapAdmin.ID); err != nil {
			if database != nil {
				_ = database.Close()
			}
			return nil, err
		}
	}
	scriptHandler, err := scripts.NewHandler(scriptService)
	if err != nil {
		if database != nil {
			_ = database.Close()
		}
		return nil, err
	}
	deps.ScriptHandler = scriptHandler

	deps.HealthService = health.NewService(cfg, databaseSQL(database), sessionManager)
	if authService != nil {
		deps.AuthService = authService
	}

	router := NewRouter(cfg, logger, deps)
	httpServer := NewHTTPServer(cfg, router, logger)

	app := &App{
		cfg:             cfg,
		logger:          logger,
		router:          router,
		httpServer:      httpServer,
		database:        database,
		agentAutomation: agentAutomation,
	}

	app.logger.Info("application assembled", "http_addr", cfg.HTTP.Address())

	return app, nil
}

func databaseSQL(database *storage.Postgres) *sql.DB {
	if database == nil {
		return nil
	}

	return database.DB()
}

type accountPhoneLookup struct {
	repository *accounts.Repository
}

func (l accountPhoneLookup) LookupPhone(ctx context.Context, accountID string) (*string, error) {
	if l.repository == nil {
		return nil, fmt.Errorf("account repository is not configured")
	}

	account, err := l.repository.GetByID(ctx, accountID)
	if err != nil {
		return nil, err
	}

	return account.PhoneNumber, nil
}

type accountAccessChecker struct {
	repository *accounts.Repository
}

func (c accountAccessChecker) CanAccessAccount(ctx context.Context, accountID string) bool {
	if c.repository == nil {
		return false
	}

	_, err := c.repository.GetByID(ctx, accountID)
	return err == nil
}

func (a *App) Run(ctx context.Context) error {
	if a.httpServer == nil {
		return fmt.Errorf("http server is not initialized")
	}

	if a.agentAutomation != nil {
		go a.agentAutomation.Run(ctx)
	}

	serverErrCh := make(chan error, 1)
	go func() {
		a.logger.Info("starting http server", "addr", a.cfg.HTTP.Address())
		serverErrCh <- a.httpServer.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		a.logger.Info("shutdown signal received")

		shutdownCtx, cancel := context.WithTimeout(context.Background(), a.cfg.HTTP.ShutdownTimeout)
		defer cancel()

		if err := a.Shutdown(shutdownCtx); err != nil {
			return err
		}

		err := <-serverErrCh
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}

		a.logger.Info("http server stopped cleanly")
		return nil
	case err := <-serverErrCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}

		return nil
	}
}

func (a *App) Shutdown(ctx context.Context) error {
	if a.httpServer != nil {
		a.logger.Info("shutting down http server")
		if err := a.httpServer.Shutdown(ctx); err != nil {
			return err
		}
	}

	if a.database != nil {
		a.logger.Info("closing database connection")
		if err := a.database.Close(); err != nil {
			return err
		}
	}

	return nil
}
