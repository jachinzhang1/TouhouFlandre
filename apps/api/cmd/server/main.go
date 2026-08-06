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

	// 服务重启明确终止（08 §4.6）：启动时对进行中对局（含 countdown 态局）判平终止，不静默丢失。
	timing := multi.DefaultTimingConfig() // Phase 6 统一接 internal/config
	terminated, err := multi.TerminateActiveMatches(ctx, pool, time.Now(), timing)
	if err != nil {
		fatal("terminate active matches:", err)
	}
	if terminated > 0 {
		fmt.Printf("server: terminated %d active match(es) after restart\n", terminated)
	}

	// 唯一后台调度器（08 §6.3）：对局推进 + 房间 TTL/展示期/清理。
	sweeper := multi.NewSweeper(pool, multi.SweeperConfig{
		Timing:         timing,
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
