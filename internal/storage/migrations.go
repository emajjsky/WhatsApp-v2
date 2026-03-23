package storage

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const defaultMigrationsDir = "deploy/migrations"

type Migrator struct {
	dir string
}

func NewMigrator(dir string) *Migrator {
	if strings.TrimSpace(dir) == "" {
		dir = defaultMigrationsDir
	}

	return &Migrator{dir: dir}
}

func (m *Migrator) Apply(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database handle must not be nil")
	}

	if err := ensureSchemaMigrationsTable(ctx, db); err != nil {
		return err
	}

	files, err := m.migrationFiles()
	if err != nil {
		return err
	}

	applied, err := m.appliedVersions(ctx, db)
	if err != nil {
		return err
	}

	for _, file := range files {
		version := strings.TrimSuffix(filepath.Base(file), filepath.Ext(file))
		if _, exists := applied[version]; exists {
			continue
		}

		if err := m.applyFile(ctx, db, file, version); err != nil {
			return err
		}
	}

	return nil
}

func ensureSchemaMigrationsTable(ctx context.Context, db *sql.DB) error {
	const stmt = `
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`

	if _, err := db.ExecContext(ctx, stmt); err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	return nil
}

func (m *Migrator) migrationFiles() ([]string, error) {
	entries, err := os.ReadDir(m.dir)
	if err != nil {
		return nil, fmt.Errorf("read migrations dir %q: %w", m.dir, err)
	}

	files := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		files = append(files, filepath.Join(m.dir, entry.Name()))
	}

	sort.Strings(files)

	return files, nil
}

func (m *Migrator) appliedVersions(ctx context.Context, db *sql.DB) (map[string]struct{}, error) {
	rows, err := db.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("query schema_migrations: %w", err)
	}
	defer rows.Close()

	versions := make(map[string]struct{})
	for rows.Next() {
		var version string
		if err := rows.Scan(&version); err != nil {
			return nil, fmt.Errorf("scan schema_migrations row: %w", err)
		}

		versions[version] = struct{}{}
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate schema_migrations rows: %w", err)
	}

	return versions, nil
}

func (m *Migrator) applyFile(ctx context.Context, db *sql.DB, filePath, version string) error {
	contents, err := os.ReadFile(filePath)
	if err != nil {
		return fmt.Errorf("read migration %q: %w", filePath, err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration transaction for %q: %w", version, err)
	}

	if _, err := tx.ExecContext(ctx, string(contents)); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("execute migration %q: %w", version, err)
	}

	if _, err := tx.ExecContext(
		ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1)`,
		version,
	); err != nil {
		_ = tx.Rollback()
		return fmt.Errorf("record migration %q: %w", version, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migration %q: %w", version, err)
	}

	return nil
}
