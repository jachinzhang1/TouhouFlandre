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
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
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

	// 唯一后台调度器（08 §6.3）：大厅 TTL / closed 清理；对局职责 Phase 3 扩展。
	sweeper := multi.NewSweeper(pool, multi.SweeperConfig{
		LobbyTTL:       config.MultiLobbyTTL(),
		EventRetention: config.MultiEventRetention(),
		Interval:       time.Second,
	})
	sweeperCtx, stopSweeper := context.WithCancel(ctx)
	defer stopSweeper()
	go sweeper.Run(sweeperCtx)

	port := config.APIPort()
	go func() {
		if err := e.Start(":" + port); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("start server:", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// 排空：先停 sweeper（不再产生新事件），再优雅关停 Echo。
	// 完整排空链（终止对局 → 关 WS(1012) → 停 sweeper → shutdown）Phase 4/6 扩展。
	stopSweeper()
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
