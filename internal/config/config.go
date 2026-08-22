package config

import (
	"bufio"
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	AppName      string
	Environment  string
	HTTP         HTTPConfig
	Database     DatabaseConfig
	Auth         AuthConfig
	Logging      LoggingConfig
	Integrations IntegrationConfig
}

type HTTPConfig struct {
	Host            string
	Port            int
	ReadTimeout     time.Duration
	WriteTimeout    time.Duration
	IdleTimeout     time.Duration
	ShutdownTimeout time.Duration
}

type LoggingConfig struct {
	Level  string
	Format string
}

type DatabaseConfig struct {
	Driver        string
	DSN           string
	AutoMigrate   bool
	MigrationsDir string
}

type AuthConfig struct {
	CookieName             string
	SessionTTL             time.Duration
	RegistrationEnabled    bool
	BootstrapAdminEmail    string
	BootstrapAdminPassword string
	BootstrapAdminName     string
	SecureCookie           bool
}

type IntegrationConfig struct {
	AgentRunnerBaseURL      string
	WhatsAppProxyURL        string
	LocalProxyCredentialKey string
	CloudAuthBaseURL        string
	AgentAutoSendEnabled    bool
}

func Load() (Config, error) {
	loadDotenv()

	cfg := Config{
		AppName:     stringEnv("APP_NAME", "whatsapp-agent-platform"),
		Environment: stringEnv("APP_ENV", "development"),
		HTTP: HTTPConfig{
			Host:            stringEnv("HTTP_HOST", "0.0.0.0"),
			Port:            intEnv("HTTP_PORT", 8080),
			ReadTimeout:     durationEnv("HTTP_READ_TIMEOUT", 10*time.Second),
			WriteTimeout:    durationEnv("HTTP_WRITE_TIMEOUT", 15*time.Second),
			IdleTimeout:     durationEnv("HTTP_IDLE_TIMEOUT", 60*time.Second),
			ShutdownTimeout: durationEnv("HTTP_SHUTDOWN_TIMEOUT", 20*time.Second),
		},
		Database: DatabaseConfig{
			Driver:        stringEnv("DB_DRIVER", "postgres"),
			DSN:           strings.TrimSpace(os.Getenv("DB_DSN")),
			AutoMigrate:   boolEnv("DB_AUTO_MIGRATE", true),
			MigrationsDir: stringEnv("DB_MIGRATIONS_DIR", "deploy/migrations"),
		},
		Auth: AuthConfig{
			CookieName:             stringEnv("AUTH_COOKIE_NAME", "wa_session"),
			SessionTTL:             durationEnv("AUTH_SESSION_TTL", 7*24*time.Hour),
			RegistrationEnabled:    boolEnv("AUTH_REGISTRATION_ENABLED", true),
			BootstrapAdminEmail:    stringEnv("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@example.com"),
			BootstrapAdminPassword: stringEnv("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "admin123456"),
			BootstrapAdminName:     stringEnv("AUTH_BOOTSTRAP_ADMIN_NAME", "Administrator"),
			SecureCookie:           boolEnv("AUTH_SECURE_COOKIE", false),
		},
		Logging: LoggingConfig{
			Level:  stringEnv("LOG_LEVEL", "info"),
			Format: stringEnv("LOG_FORMAT", "text"),
		},
		Integrations: IntegrationConfig{
			AgentRunnerBaseURL:      strings.TrimSpace(os.Getenv("AGENT_RUNNER_BASE_URL")),
			WhatsAppProxyURL:        strings.TrimSpace(os.Getenv("WHATSAPP_PROXY_URL")),
			LocalProxyCredentialKey: strings.TrimSpace(os.Getenv("LOCAL_PROXY_CREDENTIAL_KEY")),
			CloudAuthBaseURL:        strings.TrimSpace(os.Getenv("CLOUD_AUTH_BASE_URL")),
			AgentAutoSendEnabled:    boolEnv("AGENT_AUTO_SEND_ENABLED", false),
		},
	}

	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}

	return cfg, nil
}

func loadDotenv() {
	env := strings.TrimSpace(os.Getenv("APP_ENV"))
	if env != "" && !strings.EqualFold(env, "development") && !strings.EqualFold(env, "dev") {
		return
	}

	file, err := os.Open(".env")
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}

		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}

		key := strings.TrimSpace(strings.TrimPrefix(line[:idx], "\ufeff"))
		if key == "" {
			continue
		}
		if _, exists := os.LookupEnv(key); exists {
			continue
		}

		value := strings.TrimSpace(line[idx+1:])
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') || (value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}

		_ = os.Setenv(key, value)
	}
}

func (c Config) Validate() error {
	if strings.TrimSpace(c.AppName) == "" {
		return fmt.Errorf("APP_NAME must not be empty")
	}
	if strings.TrimSpace(c.Environment) == "" {
		return fmt.Errorf("APP_ENV must not be empty")
	}
	if strings.TrimSpace(c.HTTP.Host) == "" {
		return fmt.Errorf("HTTP_HOST must not be empty")
	}
	if c.HTTP.Port < 1 || c.HTTP.Port > 65535 {
		return fmt.Errorf("HTTP_PORT must be between 1 and 65535")
	}
	if c.HTTP.ReadTimeout <= 0 {
		return fmt.Errorf("HTTP_READ_TIMEOUT must be greater than zero")
	}
	if c.HTTP.WriteTimeout <= 0 {
		return fmt.Errorf("HTTP_WRITE_TIMEOUT must be greater than zero")
	}
	if c.HTTP.IdleTimeout <= 0 {
		return fmt.Errorf("HTTP_IDLE_TIMEOUT must be greater than zero")
	}
	if c.HTTP.ShutdownTimeout <= 0 {
		return fmt.Errorf("HTTP_SHUTDOWN_TIMEOUT must be greater than zero")
	}
	if !isSupportedLogLevel(c.Logging.Level) {
		return fmt.Errorf("LOG_LEVEL must be one of: debug, info, warn, error")
	}
	if !isSupportedLogFormat(c.Logging.Format) {
		return fmt.Errorf("LOG_FORMAT must be one of: text, json")
	}
	if c.Database.DSN != "" && strings.TrimSpace(c.Database.Driver) == "" {
		return fmt.Errorf("DB_DRIVER must not be empty when DB_DSN is configured")
	}
	if c.Database.AutoMigrate && strings.TrimSpace(c.Database.MigrationsDir) == "" {
		return fmt.Errorf("DB_MIGRATIONS_DIR must not be empty when DB_AUTO_MIGRATE is enabled")
	}
	if strings.TrimSpace(c.Auth.CookieName) == "" {
		return fmt.Errorf("AUTH_COOKIE_NAME must not be empty")
	}
	if c.Auth.SessionTTL <= 0 {
		return fmt.Errorf("AUTH_SESSION_TTL must be greater than zero")
	}
	if strings.TrimSpace(c.Auth.BootstrapAdminEmail) == "" {
		return fmt.Errorf("AUTH_BOOTSTRAP_ADMIN_EMAIL must not be empty")
	}
	if strings.TrimSpace(c.Auth.BootstrapAdminPassword) == "" {
		return fmt.Errorf("AUTH_BOOTSTRAP_ADMIN_PASSWORD must not be empty")
	}
	if c.Integrations.AgentRunnerBaseURL != "" {
		parsed, err := url.Parse(c.Integrations.AgentRunnerBaseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("AGENT_RUNNER_BASE_URL must be a valid absolute URL")
		}
	}
	if c.Integrations.WhatsAppProxyURL != "" {
		parsed, err := url.Parse(c.Integrations.WhatsAppProxyURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("WHATSAPP_PROXY_URL must be a valid absolute URL")
		}
	}
	if c.Integrations.CloudAuthBaseURL != "" {
		parsed, err := url.Parse(c.Integrations.CloudAuthBaseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" {
			return fmt.Errorf("CLOUD_AUTH_BASE_URL must be a valid absolute URL")
		}
	}

	return nil
}

func (c HTTPConfig) Address() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

func isSupportedLogLevel(level string) bool {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug", "info", "warn", "error":
		return true
	default:
		return false
	}
}

func isSupportedLogFormat(format string) bool {
	switch strings.ToLower(strings.TrimSpace(format)) {
	case "text", "json":
		return true
	default:
		return false
	}
}

func stringEnv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	return value
}

func intEnv(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func durationEnv(key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}

	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}

	return parsed
}

func boolEnv(key string, fallback bool) bool {
	value := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if value == "" {
		return fallback
	}

	switch value {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}
