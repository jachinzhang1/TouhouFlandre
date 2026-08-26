package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

func main() {
	// 全进程统一 slog（JSON 输出，级别 LOG_LEVEL；echo v5 的 e.Logger 即此默认实例）。
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: config.LogLevel()})))

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, config.DatabaseURL())
	if err != nil {
		fatal("connect database", err)
	}
	defer pool.Close()

	// 服务重启明确终止（08 §4.6）：启动时对进行中对局（含 countdown 态局）判平终止，不静默丢失。
	timing := config.MultiTiming()
	registry, err := assembly.ForProfile(config.MultiModeRegistry())
	if err != nil {
		fatal("configure multiplayer registry", err)
	}
	clock := core.SystemClock{}
	random := core.NewRandomSource()
	terminated, err := multi.TerminateActiveMatches(ctx, pool, clock.Now(), timing, registry)
	if err != nil {
		fatal("terminate active matches", err)
	}
	if terminated > 0 {
		slog.Info("terminated active matches after restart", "count", terminated)
	}

	// 实时通道（handler 与 sweeper 共享单实例：事件先入库后广播）。
	h := hub.New(pool, config.MultiDisconnectGrace(), config.MultiWSReadLimit(), config.MultiWSSendQueue(), config.MultiProjectionSecret(), config.MultiChatRetention(), config.MultiChatCursorSecret(), registry)
	e := server.NewWithOptions(pool, handler.WithMultiTiming(timing), handler.WithHub(h), handler.WithMultiplayerKernel(registry, clock, random))
	modeRecoveries := []multi.ModeRecovery{}
	modeForfeiters := []multi.ModeMemberForfeiter{}
	announcements := multi.NewSystemAnnouncementWriter(config.MultiSystemAnnouncementsEnabled())
	if _, capabilityErr := registry.CommandHandler(core.ModeRelay); capabilityErr == nil {
		_, relayRecovery, runtimeErr := relayadapter.NewRuntime(pool, clock, random, timing, announcements)
		if runtimeErr != nil {
			fatal("configure relay recovery", runtimeErr)
		}
		modeRecoveries = append(modeRecoveries, relayRecovery)
		modeForfeiters = append(modeForfeiters, relayRecovery)
	}

	// 唯一后台调度器（08 §6.3）：对局推进 + 房间 TTL/展示期/清理。
	sweeper := multi.NewSweeper(pool, multi.SweeperConfig{
		Timing:         timing,
		EventRetention: config.MultiEventRetention(),
		ChatRetention:  config.MultiChatRetention(),
		Interval:       time.Second,
		Broadcaster:    h,
		Registry:       registry,
		Clock:          clock,
		Random:         random,
		ModeRecoveries: modeRecoveries,
		ModeForfeiters: modeForfeiters,
		Announcements:  announcements,
	})
	sweeperCtx, stopSweeper := context.WithCancel(ctx)
	defer stopSweeper()
	go sweeper.Run(sweeperCtx)

	// echo v5 把优雅关闭收进 Start 的信号机制，但本服务需要自定义排空顺序
	// （终止对局 → 关 WS → 停 sweeper → HTTP shutdown），故自建 http.Server。
	port := config.APIPort()
	srv := &http.Server{Addr: ":" + port, Handler: e}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fatal("start server", err)
		}
	}()
	slog.Info("http server started", "address", srv.Addr)

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// 优雅排空（08 §11.2）：终止进行中对局 → 关 WS(1012) → 停 sweeper → shutdown。
	_, _ = multi.TerminateActiveMatches(ctx, pool, clock.Now(), timing, registry)
	h.CloseAll()
	stopSweeper()
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		fatal("shutdown", err)
	}
	slog.Info("server shut down")
}

func fatal(prefix string, err error) {
	slog.Error(prefix, "error", err)
	os.Exit(1)
}
