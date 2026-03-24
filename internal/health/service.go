package health

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"whatsapp-agent-platform/internal/config"
	"whatsapp-agent-platform/internal/sessions"
)

type ComponentStatus string

const (
	ComponentStatusOK   ComponentStatus = "ok"
	ComponentStatusWarn ComponentStatus = "warn"
	ComponentStatusDown ComponentStatus = "down"
)

type ComponentReport struct {
	Name    string         `json:"name"`
	Status  ComponentStatus `json:"status"`
	Summary string         `json:"summary"`
	Details map[string]any `json:"details,omitempty"`
}

type Summary struct {
	Service     string            `json:"service"`
	Environment string            `json:"environment"`
	Status      string            `json:"status"`
	Timestamp   time.Time         `json:"timestamp"`
	Components  []ComponentReport `json:"components"`
	Metrics     map[string]int    `json:"metrics"`
}

type SessionInventory interface {
	ListSnapshots(ctx context.Context) ([]sessions.SessionSnapshot, error)
}

type Service struct {
	cfg          config.Config
	db           *sql.DB
	sessions     SessionInventory
	httpClient   *http.Client
	agentRunner  string
}

func NewService(cfg config.Config, db *sql.DB, sessions SessionInventory) *Service {
	return &Service{
		cfg:      cfg,
		db:       db,
		sessions: sessions,
		httpClient: &http.Client{
			Timeout: 2 * time.Second,
		},
		agentRunner: strings.TrimRight(cfg.Integrations.AgentRunnerBaseURL, "/"),
	}
}

func (s *Service) Summary(ctx context.Context) Summary {
	summary := Summary{
		Service:     s.cfg.AppName,
		Environment: s.cfg.Environment,
		Status:      "ok",
		Timestamp:   time.Now().UTC(),
		Components:  make([]ComponentReport, 0, 5),
		Metrics:     make(map[string]int),
	}

	summary.Components = append(summary.Components, s.databaseComponent(ctx, &summary))
	summary.Components = append(summary.Components, s.sessionComponent(ctx, &summary))
	summary.Components = append(summary.Components, s.exportComponent(ctx, &summary))
	summary.Components = append(summary.Components, s.agentComponent(ctx, &summary))
	summary.Components = append(summary.Components, s.auditComponent(ctx, &summary))

	return summary
}

func (s *Service) databaseComponent(ctx context.Context, summary *Summary) ComponentReport {
	if s.db == nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "database",
			Status:  ComponentStatusWarn,
			Summary: "Database is not configured",
		}
	}

	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	if err := s.db.PingContext(pingCtx); err != nil {
		markOverall(summary, ComponentStatusDown)
		return ComponentReport{
			Name:    "database",
			Status:  ComponentStatusDown,
			Summary: "Database ping failed",
			Details: map[string]any{"error": err.Error()},
		}
	}

	for key, query := range map[string]string{
		"accounts_total": "SELECT COUNT(*) FROM accounts",
		"chats_total":    "SELECT COUNT(*) FROM chats",
		"messages_total": "SELECT COUNT(*) FROM messages",
	} {
		if count, err := queryCount(ctx, s.db, query); err == nil {
			summary.Metrics[key] = count
		}
	}

	return ComponentReport{
		Name:    "database",
		Status:  ComponentStatusOK,
		Summary: "Database is reachable",
		Details: map[string]any{
			"accounts_total": summary.Metrics["accounts_total"],
			"chats_total":    summary.Metrics["chats_total"],
			"messages_total": summary.Metrics["messages_total"],
		},
	}
}

func (s *Service) sessionComponent(ctx context.Context, summary *Summary) ComponentReport {
	if s.sessions == nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "sessions",
			Status:  ComponentStatusWarn,
			Summary: "Session inventory is not configured",
		}
	}

	items, err := s.sessions.ListSnapshots(ctx)
	if err != nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "sessions",
			Status:  ComponentStatusWarn,
			Summary: "Unable to inspect session inventory",
			Details: map[string]any{"error": err.Error()},
		}
	}

	counts := map[string]int{}
	for _, item := range items {
		counts[item.Status]++
	}

	summary.Metrics["sessions_total"] = len(items)
	summary.Metrics["sessions_connected"] = counts["connected"]
	summary.Metrics["sessions_pairing"] = counts["pairing"]

	status := ComponentStatusOK
	if counts["failed"] > 0 {
		status = ComponentStatusWarn
	}
	markOverall(summary, status)

	return ComponentReport{
		Name:    "sessions",
		Status:  status,
		Summary: fmt.Sprintf("%d tracked sessions, %d connected", len(items), counts["connected"]),
		Details: map[string]any{
			"statuses": counts,
		},
	}
}

func (s *Service) exportComponent(ctx context.Context, summary *Summary) ComponentReport {
	if s.db == nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "exports",
			Status:  ComponentStatusWarn,
			Summary: "Export health is unavailable without a database",
		}
	}

	counts, err := queryGroupedCounts(ctx, s.db, "SELECT status, COUNT(*) FROM export_jobs GROUP BY status")
	if err != nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "exports",
			Status:  ComponentStatusWarn,
			Summary: "Export job summary query failed",
			Details: map[string]any{"error": err.Error()},
		}
	}

	summary.Metrics["exports_queued"] = counts["queued"]
	summary.Metrics["exports_running"] = counts["running"]
	summary.Metrics["exports_failed"] = counts["failed"]

	status := ComponentStatusOK
	if counts["failed"] > 0 || counts["running"] > 10 {
		status = ComponentStatusWarn
	}
	markOverall(summary, status)

	return ComponentReport{
		Name:    "exports",
		Status:  status,
		Summary: fmt.Sprintf("%d queued, %d running, %d failed", counts["queued"], counts["running"], counts["failed"]),
		Details: map[string]any{"statuses": counts},
	}
}

func (s *Service) agentComponent(ctx context.Context, summary *Summary) ComponentReport {
	report := ComponentReport{
		Name:   "agents",
		Status: ComponentStatusOK,
		Details: map[string]any{},
	}

	if s.db != nil {
		if enabledRules, err := queryCount(ctx, s.db, "SELECT COUNT(*) FROM agent_rules WHERE enabled = TRUE"); err == nil {
			summary.Metrics["agent_rules_enabled"] = enabledRules
			report.Details["enabled_rules"] = enabledRules
		}
		if pendingRuns, err := queryCount(ctx, s.db, "SELECT COUNT(*) FROM agent_runs WHERE status IN ('queued', 'generating', 'ready_for_review')"); err == nil {
			summary.Metrics["agent_runs_pending"] = pendingRuns
			report.Details["pending_runs"] = pendingRuns
		}
	}

	if s.agentRunner == "" {
		report.Status = ComponentStatusWarn
		report.Summary = "Agent runner endpoint is not configured"
		markOverall(summary, report.Status)
		return report
	}

	health, err := s.fetchAgentRunnerHealth(ctx)
	if err != nil {
		report.Status = ComponentStatusWarn
		report.Summary = "Agent runner is unreachable"
		report.Details["error"] = err.Error()
		report.Details["base_url"] = s.agentRunner
		markOverall(summary, report.Status)
		return report
	}

	report.Summary = "Agent runner responded normally"
	report.Details["base_url"] = s.agentRunner
	report.Details["runner"] = health
	markOverall(summary, report.Status)
	return report
}

func (s *Service) auditComponent(ctx context.Context, summary *Summary) ComponentReport {
	if s.db == nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "audit",
			Status:  ComponentStatusWarn,
			Summary: "Audit storage is unavailable without a database",
		}
	}

	total, err := queryCount(ctx, s.db, "SELECT COUNT(*) FROM audit_logs")
	if err != nil {
		markOverall(summary, ComponentStatusWarn)
		return ComponentReport{
			Name:    "audit",
			Status:  ComponentStatusWarn,
			Summary: "Audit summary query failed",
			Details: map[string]any{"error": err.Error()},
		}
	}

	last24h, err := queryCount(ctx, s.db, "SELECT COUNT(*) FROM audit_logs WHERE created_at >= NOW() - INTERVAL '24 hours'")
	if err == nil {
		summary.Metrics["audit_last_24h"] = last24h
	}
	summary.Metrics["audit_total"] = total

	return ComponentReport{
		Name:    "audit",
		Status:  ComponentStatusOK,
		Summary: fmt.Sprintf("%d audit records stored", total),
		Details: map[string]any{
			"total":     total,
			"last_24_h": last24h,
		},
	}
}

func (s *Service) fetchAgentRunnerHealth(ctx context.Context) (map[string]any, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.agentRunner+"/healthz", nil)
	if err != nil {
		return nil, err
	}

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= http.StatusBadRequest {
		return nil, fmt.Errorf("agent runner returned status %d", resp.StatusCode)
	}

	payload := make(map[string]any)
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode agent runner health: %w", err)
	}

	return payload, nil
}

func queryCount(ctx context.Context, db *sql.DB, query string) (int, error) {
	var count int
	if err := db.QueryRowContext(ctx, query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func queryGroupedCounts(ctx context.Context, db *sql.DB, query string) (map[string]int, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	counts := make(map[string]int)
	for rows.Next() {
		var status string
		var count int
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		counts[status] = count
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return counts, nil
}

func markOverall(summary *Summary, status ComponentStatus) {
	switch status {
	case ComponentStatusDown:
		summary.Status = "down"
	case ComponentStatusWarn:
		if summary.Status == "ok" {
			summary.Status = "degraded"
		}
	}
}
