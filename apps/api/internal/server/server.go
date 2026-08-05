// Package server 组装 Echo 应用：路由、OpenAPI 校验、健康端点与错误映射。
package server

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	oapimiddleware "github.com/oapi-codegen/echo-middleware"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
)

// New 构建 Echo 应用。
func New(pool *pgxpool.Pool) *echo.Echo {
	e := echo.New()
	e.HideBanner = true
	e.Use(middleware.Logger())
	e.Use(middleware.Recover())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: config.WebOrigins(),
	}))

	swagger, err := openapi.GetSwagger()
	if err != nil {
		panic("server: load embedded openapi spec: " + err.Error())
	}
	validator := oapimiddleware.OapiRequestValidator(swagger)
	e.Use(func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Path() == "/livez" || c.Path() == "/readyz" {
				return next(c)
			}
			return validator(next)(c)
		}
	})

	api := handler.NewServer(pool)
	openapi.RegisterHandlers(e, openapi.NewStrictHandler(api, nil))

	e.GET("/livez", func(c echo.Context) error {
		return c.JSON(http.StatusOK, map[string]bool{"ok": true})
	})
	e.GET("/readyz", func(c echo.Context) error {
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
func errorHandler(err error, c echo.Context) {
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
