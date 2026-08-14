// OpenAPI 请求校验中间件（echo v5 原生实现）。
//
// 逻辑移植自 github.com/oapi-codegen/echo-middleware v1.1.0（MIT，https://github.com/oapi-codegen/echo-middleware）：
// 该模块仅支持 echo/v4 且无 v5 版本，故在仓库内以 echo/v5 类型重写等价校验
// （路由查找 + 参数/body 校验 + 错误映射），删除 v4 依赖。
package server

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"github.com/labstack/echo/v5"
)

// oapiValidator 构造请求校验中间件（openapi3filter 校验 body/参数/路径）。
func oapiValidator(spec *openapi3.T) echo.MiddlewareFunc {
	router, err := gorillamux.NewRouter(spec)
	if err != nil {
		panic("server: build openapi router: " + err.Error())
	}
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c *echo.Context) error {
			if httpErr := validateRequest(c, router); httpErr != nil {
				return httpErr
			}
			return next(c)
		}
	}
}

// validateRequest 查找路由并校验请求，失败返回 *echo.HTTPError（映射到契约 ErrorResponse）。
func validateRequest(c *echo.Context, router routers.Router) *echo.HTTPError {
	req := c.Request()
	route, pathParams, err := router.FindRoute(req)
	if err != nil {
		if errors.Is(err, routers.ErrMethodNotAllowed) {
			return echo.NewHTTPError(http.StatusMethodNotAllowed, "")
		}
		switch e := err.(type) {
		case *routers.RouteError:
			return echo.NewHTTPError(http.StatusNotFound, e.Reason)
		default:
			return echo.NewHTTPError(http.StatusInternalServerError,
				fmt.Sprintf("error validating route: %s", err.Error()))
		}
	}
	// gorillamux 返回百分号编码的路径参数，openapi3filter 需要解码后的值。
	for k, v := range pathParams {
		if unescaped, err := url.PathUnescape(v); err == nil {
			pathParams[k] = unescaped
		}
	}

	validationInput := &openapi3filter.RequestValidationInput{
		Request:    req,
		PathParams: pathParams,
		Route:      route,
	}
	validationErr := openapi3filter.ValidateRequest(context.Background(), validationInput)
	if validationErr == nil {
		return nil
	}

	var me openapi3.MultiError
	if errors.As(validationErr, &me) {
		if strings.HasSuffix(req.URL.Path, "/messages") {
			slog.Warn("request validation failed", "uri", req.URL.Path, "reason", "invalid_chat_request")
			return &echo.HTTPError{Code: http.StatusBadRequest, Message: "聊天请求格式不合法。"}
		} else {
			slog.Warn("request validation failed", "uri", req.URL.Path, "error", me.Error())
		}
		return &echo.HTTPError{Code: http.StatusBadRequest, Message: me.Error()}
	}

	var reqErr *openapi3filter.RequestError
	if errors.As(validationErr, &reqErr) {
		// openapi3filter 的错误消息多行，取首行作为用户可读信息。
		errorLines := strings.Split(reqErr.Error(), "\n")
		if strings.HasSuffix(req.URL.Path, "/messages") {
			slog.Warn("request validation failed", "uri", req.URL.Path, "reason", "invalid_chat_request")
			return &echo.HTTPError{Code: http.StatusBadRequest, Message: "聊天请求格式不合法。"}
		} else {
			slog.Warn("request validation failed", "uri", req.URL.Path, "error", reqErr.Error())
		}
		return &echo.HTTPError{
			Code:    http.StatusBadRequest,
			Message: errorLines[0],
		}
	}

	slog.Error("request validation: unexpected error", "uri", req.URL.Path, "error", validationErr)
	return &echo.HTTPError{
		Code:    http.StatusInternalServerError,
		Message: fmt.Sprintf("error validating request: %s", validationErr),
	}
}
