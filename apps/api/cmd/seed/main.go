// cmd/seed 从 packages/data 题库 JSON 重建 Postgres 快照与行表。
package main

import (
	"context"
	"log/slog"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/seed"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: config.LogLevel()})))

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, config.DatabaseURL())
	if err != nil {
		fatal("connect database", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fatal("ping database", err)
	}

	version, err := seed.Run(ctx, pool, config.CatalogDataDir())
	if err != nil {
		fatal("seed", err)
	}
	slog.Info("seeded catalog", "version", version)
}

func fatal(prefix string, err error) {
	slog.Error(prefix, "error", err)
	os.Exit(1)
}
