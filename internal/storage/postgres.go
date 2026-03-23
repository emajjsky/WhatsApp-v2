package storage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	_ "github.com/jackc/pgx/v5/stdlib"
)

type DBTX interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

type Postgres struct {
	db *sql.DB
}

func Open(ctx context.Context, driverName, dsn string) (*Postgres, error) {
	if strings.TrimSpace(driverName) == "" {
		return nil, fmt.Errorf("database driver name must not be empty")
	}
	if strings.TrimSpace(dsn) == "" {
		return nil, fmt.Errorf("database dsn must not be empty")
	}

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}

	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return &Postgres{db: db}, nil
}

func NewPostgres(db *sql.DB) (*Postgres, error) {
	if db == nil {
		return nil, fmt.Errorf("database handle must not be nil")
	}

	return &Postgres{db: db}, nil
}

func (p *Postgres) DB() *sql.DB {
	if p == nil {
		return nil
	}

	return p.db
}

func (p *Postgres) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if p == nil || p.db == nil {
		return nil, fmt.Errorf("database handle must not be nil")
	}

	tx, err := p.db.BeginTx(ctx, opts)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}

	return tx, nil
}

func (p *Postgres) Close() error {
	if p == nil || p.db == nil {
		return nil
	}

	return p.db.Close()
}
