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

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v5"
	"github.com/labstack/echo/v5/middleware"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
)

// New 构建 Echo 应用。
func New(pool *pgxpool.Pool) *echo.Echo {
	return NewWithOptions(pool)
}

// NewWithOptions 构建 Echo 应用（opts 透传 handler.NewServer，测试注入用）。
// 默认创建实时 hub（时间/限流常量来自 internal/config）；显式 WithHub 可覆盖（与 sweeper 共享单实例）。
func NewWithOptions(pool *pgxpool.Pool, opts ...handler.Option) *echo.Echo {
	h := hub.New(pool, config.MultiDisconnectGrace(), config.MultiWSReadLimit(), config.MultiWSSendQueue())
	opts = append([]handler.Option{handler.WithHub(h)}, opts...)
	e := echo.New()
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
		AllowOrigins: config.WebOrigins(),
	}))

	swagger, err := openapi.GetSwagger()
	if err != nil {
		panic("server: load embedded openapi spec: " + err.Error())
	}
	validator := oapiValidator(swagger)
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			path := c.Request().URL.Path
			// /api/rooms* 跳过 OpenAPI 请求校验：
			// 1) 08 §7.1 的 /api/rooms/{roomCode}(GET) 与 /api/rooms/{roomId}(DELETE) 同形路径
			//    超出 kin-openapi gorillamux 路由能力（ErrMethodNotAllowed 短路，见 redocly 例外注释）；
			// 2) 游客鉴权在 handler 中间件（RoomGuardMiddleware）执行，契约 security 仅作文档。
			// 参数/body 校验由 oapi-codegen 生成的 wrapper 与 handler 层等价完成。
			if path == "/livez" || path == "/readyz" || strings.HasPrefix(path, "/api/rooms") {
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
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
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
	if errors.As(err, &apiErr) {
		_ = c.JSON(apiErr.Status, apiErr.Response())
		return
	}

	var httpErr *echo.HTTPError
	if errors.As(err, &httpErr) {
		code := openapi.ErrorResponseCode("INVALID_REQUEST")
		if httpErr.Code >= http.StatusInternalServerError {
			code = "INTERNAL"
		}
		_ = c.JSON(httpErr.Code, openapi.ErrorResponse{
			Code:  code,
			Error: fmt.Sprint(httpErr.Message),
		})
		return
	}

	_ = c.JSON(http.StatusInternalServerError, openapi.ErrorResponse{
		Code:  "INTERNAL",
		Error: "服务器暂时无法处理请求。",
	})
}


// requestLogValues 把 echo 请求日志映射到 slog（LevelError 用于 5xx/错误请求，其余 Info）。
func requestLogValues(c *echo.Context, v middleware.RequestLoggerValues) error {
	attrs := []slog.Attr{
		slog.String("method", v.Method),
		slog.String("uri", v.URI),
		slog.String("route", v.RoutePath),
		slog.String("remote_ip", v.RemoteIP),
		slog.Int("status", v.Status),
		slog.Duration("latency", v.Latency),
		slog.String("user_agent", v.UserAgent),
	}
	if v.Error != nil {
		attrs = append(attrs, slog.Any("error", v.Error))
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
