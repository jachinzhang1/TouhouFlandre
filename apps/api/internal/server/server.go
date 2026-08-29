// Package server 组装 Echo 应用：路由、OpenAPI 校验、健康端点与错误映射。
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// New 构建 Echo 应用。
func New(pool *pgxpool.Pool) *echo.Echo {
	return NewWithOptions(pool)
}

// NewWithOptions 构建 Echo 应用（opts 透传 handler.NewServer，测试注入用）。
// 默认创建实时 hub（时间/限流常量来自 internal/config）；显式 WithHub 可覆盖（与 sweeper 共享单实例）。
func NewWithOptions(pool *pgxpool.Pool, opts ...handler.Option) *echo.Echo {
	h := hub.New(pool, config.MultiDisconnectGrace(), config.MultiWSReadLimit(), config.MultiWSSendQueue(), config.MultiProjectionSecret(), config.MultiChatRetention(), config.MultiChatCursorSecret())
	opts = append([]handler.Option{handler.WithHub(h)}, opts...)
	e := echo.New()
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			request := c.Request()
			c.SetRequest(request.WithContext(handler.WithIfNoneMatch(request.Context(), request.Header.Get("If-None-Match"))))
			return next(c)
		}
	})
	// 请求日志走 slog（echo v5 已移除 middleware.Logger()，统一用 RequestLoggerWithConfig）。
	e.Use(middleware.RequestLoggerWithConfig(middleware.RequestLoggerConfig{
		LogLatency:    true,
		LogMethod:     true,
		LogURI:        true,
		LogRoutePath:  true,
		LogRemoteIP:   true,
		LogStatus:     true,
		LogUserAgent:  true,
		HandleError:   true,
		LogValuesFunc: requestLogValues,
	}))
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins:  config.WebOrigins(),
		AllowHeaders:  []string{"Origin", "Content-Type", "Accept", "Authorization", "X-Character-Search-Fallback-Reason"},
		ExposeHeaders: []string{"ETag", "Cache-Control"},
	}))

	swagger, err := openapi.GetSwagger()
	if err != nil {
		panic("server: load embedded openapi spec: " + err.Error())
	}
	validator := oapiValidator(swagger)
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			path := c.Request().URL.Path
			if strings.HasSuffix(path, "/messages") {
				allowed := map[string]bool{}
				if c.Request().Method == http.MethodGet {
					allowed = map[string]bool{"after": true, "before": true, "limit": true}
				}
				for key := range c.QueryParams() {
					if !allowed[key] {
						return echo.NewHTTPError(http.StatusBadRequest, "聊天请求包含未知查询参数。")
					}
				}
				// messages 路径没有 roomCode/roomId 的同形冲突，可以安全使用完整
				// OpenAPI 校验来拒绝 additionalProperties 和非法参数。
				return validator(next)(c)
			}
			// /api/rooms* 跳过 OpenAPI 请求校验：
			// 1) 08 §7.1 的 /api/rooms/{roomCode}(GET) 与 /api/rooms/{roomId}(DELETE) 同形路径
			//    超出 kin-openapi gorillamux 路由能力（ErrMethodNotAllowed 短路，见 redocly 例外注释）；
			// 2) 游客鉴权在 handler 中间件（RoomGuardMiddleware）执行，契约 security 仅作文档。
			// 参数/body 校验由 oapi-codegen 生成的 wrapper 与 handler 层等价完成。
			if path == "/livez" || path == "/readyz" || path == "/metrics" || strings.HasPrefix(path, "/api/rooms") {
				return next(c)
			}
			return validator(next)(c)
		}
	})

	api := handler.NewServer(pool, opts...)
	strict := openapi.NewStrictHandler(api, []openapi.StrictMiddlewareFunc{api.RoomGuardMiddleware()})
	openapi.RegisterHandlers(e, strict)

	e.GET("/livez", func(c *echo.Context) error {
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
	})
	e.GET("/readyz", func(c *echo.Context) error {
		pingCtx, cancel := context.WithTimeout(c.Request().Context(), 3*time.Second)
		defer cancel()
		if err := pool.Ping(pingCtx); err != nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "database unavailable"})
		}
		if err := api.SearchReadiness(pingCtx); err != nil {
			return c.JSON(http.StatusServiceUnavailable, map[string]string{"error": "catalog search unavailable"})
		}
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
	})
	e.GET("/metrics", func(c *echo.Context) error {
		c.Response().Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		c.Response().Header().Set("Cache-Control", "no-store")
		return c.String(http.StatusOK, multi.DefaultMetrics.PrometheusText()+game.DefaultSearchMetrics.PrometheusText())
	})

	e.HTTPErrorHandler = errorHandler
	return e
}

// errorHandler 将 ApiError 与框架错误映射为契约的 ErrorResponse。
func errorHandler(c *echo.Context, err error) {
	// HandleError:true 的请求日志中间件会先调用错误处理器；已写出的响应不再重复写。
	if resp, uerr := echo.UnwrapResponse(c.Response()); uerr == nil && resp.Committed {
		return
	}

	var apiErr *handler.ApiError
	if errors.As(err, &apiErr) && apiErr != nil {
		if strings.HasSuffix(c.Request().URL.Path, "/messages") {
			multi.DefaultMetrics.IncChatRejected(string(apiErr.Code))
		}
		if isNonCacheableSearchPath(c.Request().URL.Path) {
			c.Response().Header().Set("Cache-Control", "no-store")
		}
		_ = c.JSON(apiErr.Status, apiErr.Response())
		return
	}

	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		if strings.HasSuffix(c.Request().URL.Path, "/messages") {
			multi.DefaultMetrics.IncChatRejected("INVALID_REQUEST")
		}
		code := openapi.ErrorResponseCode("INVALID_REQUEST")
		if httpErr.Code >= http.StatusInternalServerError {
			code = "INTERNAL"
		}
		message := fmt.Sprint(httpErr.Message)
		if httpErr.Code >= http.StatusInternalServerError {
			message = "服务器暂时无法处理请求。"
		}
		if isNonCacheableSearchPath(c.Request().URL.Path) {
			c.Response().Header().Set("Cache-Control", "no-store")
		}
		_ = c.JSON(httpErr.Code, openapi.ErrorResponse{
			Code:  code,
			Error: message,
		})
		return
	}

	// echo v5 内建错误（ErrNotFound/ErrMethodNotAllowed/ErrBadRequest…）为未导出
	// httpError 类型，仅实现 StatusCode()；按状态码映射，避免 404 落入 500 兜底。
	if sc, ok := err.(interface{ StatusCode() int }); ok {
		code := openapi.ErrorResponseCode("INVALID_REQUEST")
		if sc.StatusCode() >= http.StatusInternalServerError {
			code = "INTERNAL"
		}
		message := err.Error()
		if sc.StatusCode() >= http.StatusInternalServerError {
			message = "服务器暂时无法处理请求。"
		}
		if isNonCacheableSearchPath(c.Request().URL.Path) {
			c.Response().Header().Set("Cache-Control", "no-store")
		}
		_ = c.JSON(sc.StatusCode(), openapi.ErrorResponse{
			Code:  code,
			Error: message,
		})
		return
	}

	if isNonCacheableSearchPath(c.Request().URL.Path) {
		c.Response().Header().Set("Cache-Control", "no-store")
	}
	_ = c.JSON(http.StatusInternalServerError, openapi.ErrorResponse{
		Code:  "INTERNAL",
		Error: "服务器暂时无法处理请求。",
	})
}

func isNonCacheableSearchPath(path string) bool {
	return strings.Contains(path, "/search-index/") || path == "/api/catalog/search-policy"
}

// requestLogValues 把 echo 请求日志映射到 slog（LevelError 用于 5xx/错误请求，其余 Info）。
func requestLogValues(c *echo.Context, v middleware.RequestLoggerValues) error {
	uri := safeRequestLogURI(c, v.RoutePath)
	attrs := []slog.Attr{
		slog.String("method", v.Method),
		slog.String("uri", uri),
		slog.String("route", v.RoutePath),
		slog.String("remote_ip", v.RemoteIP),
		slog.Int("status", v.Status),
		slog.Duration("latency", v.Latency),
		slog.String("user_agent", v.UserAgent),
	}
	if v.Error != nil {
		attrs = append(attrs, slog.String("error_code", requestErrorCode(v.Error)))
		var pgErr *pgconn.PgError
		if errors.As(v.Error, &pgErr) && pgErr.Code == "40P01" {
			multi.DefaultMetrics.IncDeadlock(multi.NewMetricLabels("unknown", "unknown", 0))
		}
		if strings.HasSuffix(c.Request().URL.Path, "/messages") {
			attrs = append(attrs, slog.String("reason", "chat_request_rejected"))
		}
		slog.Default().LogAttrs(context.Background(), slog.LevelError, "request failed", attrs...)
		return nil
	}
	if v.Status >= 500 {
		slog.Default().LogAttrs(context.Background(), slog.LevelError, "request", attrs...)
		return nil
	}
	slog.Default().LogAttrs(context.Background(), slog.LevelInfo, "request", attrs...)
	return nil
}

// safeRequestLogURI keeps request logs aggregateable without copying query
// values or concrete resource identifiers (session/room/catalog/character).
func safeRequestLogURI(c *echo.Context, routePath string) string {
	if strings.TrimSpace(routePath) != "" {
		return routePath
	}
	if strings.HasPrefix(c.Request().URL.Path, "/api/") {
		return "api.unmatched"
	}
	return c.Request().URL.Path
}

// requestErrorCode 提取契约错误码供日志聚合（ApiError 取 code；HTTPError 按状态映射，与 errorHandler 一致）。
func requestErrorCode(err error) string {
	var apiErr *handler.ApiError
	if errors.As(err, &apiErr) && apiErr != nil {
		return string(apiErr.Code)
	}
	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.Code >= http.StatusInternalServerError {
			return "INTERNAL"
		}
		return "INVALID_REQUEST"
	}
	if sc, ok := err.(interface{ StatusCode() int }); ok {
		if sc.StatusCode() >= http.StatusInternalServerError {
			return "INTERNAL"
		}
		return "INVALID_REQUEST"
	}
	return ""
}
