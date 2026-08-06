// 游客令牌鉴权（08 §5.1）。
//
// 通过 oapi-codegen strict middleware 接入（见 RoomGuardMiddleware）：
// 中间件解析 Authorization 头、校验令牌并把成员注入请求上下文，
// 房间级命令 handler 经 GuestMemberFromContext 取用。
package handler

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/labstack/echo/v4"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

type guestMemberKey struct{}

func guestUnauthorized(message string) *ApiError {
	return &ApiError{Status: http.StatusUnauthorized, Code: codeGuestUnauthorized, Message: message}
}

// GuestMemberFromContext 返回中间件注入的已鉴权成员（handler 内使用）。
func GuestMemberFromContext(ctx context.Context) (*repo.MultiMember, bool) {
	member, ok := ctx.Value(guestMemberKey{}).(*repo.MultiMember)
	return member, ok
}

// RoomGuardMiddleware 返回 strict 中间件（仅作用于 rooms_* 操作）：
//   - rooms_getInfo / rooms_join：公开 + 按 IP 速率限制（08 §8.5，与 join 共用）；
//   - rooms_getSnapshot / setReady / rematch / submitGuess / leave / close：
//     解析 Authorization: Bearer guest:{token} → 类型前缀/哈希/房间归属/成员状态校验，
//     通过则注入成员到请求上下文，失败返回 GUEST_UNAUTHORIZED（401）；
//   - rooms_connectWs：不做头鉴权（WS 走 hello 首帧鉴权，Phase 4 实现）；
//   - 其余操作（health/sessions/rooms_create）直通。
func (s *Server) RoomGuardMiddleware() openapi.StrictMiddlewareFunc {
	return func(f openapi.StrictHandlerFunc, operationID string) openapi.StrictHandlerFunc {
		return func(ctx echo.Context, request any) (any, error) {
			switch operationID {
			// 注意：strict middleware 收到的是 Go handler 方法名（如 RoomsJoin），
			// 不是 OpenAPI operationId（如 rooms_join）。
			case "RoomsGetInfo", "RoomsJoin":
				if !s.joinLimiter.allow(clientIP(ctx), s.now()) {
					return nil, &ApiError{Status: http.StatusTooManyRequests, Code: codeRateLimited, Message: "尝试过于频繁，请稍后再试。"}
				}
			case "RoomsGetSnapshot", "RoomsSetReady", "RoomsRematch",
				"RoomsSubmitGuess", "RoomsLeave", "RoomsClose":
				member, apiErr := s.authenticateGuest(ctx.Request().Context(), ctx.Request().Header.Get("Authorization"))
				if apiErr != nil {
					return nil, apiErr
				}
				if roomID, ok := roomIDFromRequest(request); ok && member.RoomID != roomID {
					return nil, guestUnauthorized("令牌不属于该房间。")
				}
				req := ctx.Request().WithContext(context.WithValue(ctx.Request().Context(), guestMemberKey{}, member))
				ctx.SetRequest(req)
			}
			return f(ctx, request)
		}
	}
}

// authenticateGuest 解析并校验令牌凭据，返回成员行（不含房间归属校验，由调用方按路径校验）。
func (s *Server) authenticateGuest(ctx context.Context, authorization string) (*repo.MultiMember, *ApiError) {
	if authorization == "" {
		return nil, guestUnauthorized("缺少令牌。")
	}
	const bearerPrefix = "Bearer "
	if !strings.HasPrefix(authorization, bearerPrefix) {
		return nil, guestUnauthorized("令牌格式错误（期望 Authorization: Bearer guest:{token}）。")
	}
	credential := strings.TrimSpace(authorization[len(bearerPrefix):])
	if !strings.HasPrefix(credential, multi.GuestTokenPrefix) {
		return nil, guestUnauthorized("令牌类型不匹配（期望 guest: 前缀）。")
	}
	token := strings.TrimPrefix(credential, multi.GuestTokenPrefix)
	if token == "" {
		return nil, guestUnauthorized("令牌为空。")
	}
	member, err := s.q.GetMemberByTokenHash(ctx, multi.HashToken(token))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, guestUnauthorized("令牌无效。")
		}
		return nil, internalError(err)
	}
	if member.Status == string(multi.MemberStatusLeft) {
		return nil, guestUnauthorized("成员已离开。")
	}
	return &member, nil
}

// roomIDFromRequest 从 strict request object 提取路径 roomId（房间级命令）。
func roomIDFromRequest(request any) (string, bool) {
	switch r := request.(type) {
	case openapi.RoomsGetSnapshotRequestObject:
		return r.RoomId, true
	case openapi.RoomsSetReadyRequestObject:
		return r.RoomId, true
	case openapi.RoomsRematchRequestObject:
		return r.RoomId, true
	case openapi.RoomsSubmitGuessRequestObject:
		return r.RoomId, true
	case openapi.RoomsLeaveRequestObject:
		return r.RoomId, true
	case openapi.RoomsCloseRequestObject:
		return r.RoomId, true
	}
	return "", false
}

// clientIP 提取客户端 IP（进程内限流键；测试环境为 127.0.0.1）。
func clientIP(ctx echo.Context) string {
	addr := ctx.Request().RemoteAddr
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return host
	}
	return addr
}
