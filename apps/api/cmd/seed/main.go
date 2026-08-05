// cmd/seed 从 packages/data 题库 JSON 重建 Postgres 快照与行表。
package main

import (
	"context"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/seed"
)

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, config.DatabaseURL())
	if err != nil {
		fatal("connect database:", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		fatal("ping database:", err)
	}

	version, err := seed.Run(ctx, pool, config.CatalogDataDir())
	if err != nil {
		fatal("seed:", err)
	}
	fmt.Printf("Seeded catalog %s.\n", version)
}

func fatal(prefix string, err error) {
	fmt.Fprintln(os.Stderr, prefix, err)
	os.Exit(1)
}
