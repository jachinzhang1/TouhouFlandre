package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

func main() {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, config.DatabaseURL())
	if err != nil {
		fatal("connect database:", err)
	}
	defer pool.Close()

	e := server.New(pool)

	port := config.APIPort()
	go func() {
		if err := e.Start(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("start server:", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := e.Shutdown(shutdownCtx); err != nil {
		fatal("shutdown:", err)
	}
}

func fatal(prefix string, err error) {
	fmt.Fprintln(os.Stderr, prefix, err)
	os.Exit(1)
}
