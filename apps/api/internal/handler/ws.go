// WebSocket 事件通道端点（08 §8.1）：升级校验（Origin + 子协议）→ 首帧 hello 鉴权
// → 注册/重放（hub）→ 阻塞服务直到断开。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/coder/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/config"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// wsSubprotocol 子协议版本协商（08 §8.1）。
const wsSubprotocol = "touhouflandre-multi.v1"

// helloTimeout 首帧 hello 等待上限（10s）。
const helloTimeout = 10 * time.Second

// RoomsConnectWs WebSocket 事件通道。
// 鉴权前不收发任何房间事件（07 §7.4）；令牌只在 hello 首帧出现，不进 URL/日志。
func (s *Server) RoomsConnectWs(ctx context.Context, request openapi.RoomsConnectWsRequestObject) (openapi.RoomsConnectWsResponseObject, error) {
	if s.hub == nil {
		return nil, &ApiError{Status: http.StatusNotImplemented, Code: codeUnsupportedContentType, Message: "实时通道未启用。"}
	}
	// 房间存在性（升级前校验，失败走 REST 错误映射）
	if _, err := s.q.GetRoom(ctx, request.RoomId); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	eCtx, ok := echoContextFrom(ctx)
	if !ok {
		return nil, internalError(errors.New("ws: echo context missing"))
	}

	// 升级校验：Origin ∈ WEB_ORIGINS + 子协议协商（不符 → 拒绝升级）
	ws, err := websocket.Accept(eCtx.Response(), eCtx.Request(), &websocket.AcceptOptions{
		OriginPatterns: config.WebOrigins(),
		Subprotocols:   []string{wsSubprotocol},
	})
	if err != nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "WebSocket 升级校验失败（Origin/子协议不符）。"}
	}
	if ws.Subprotocol() != wsSubprotocol {
		// coder/websocket：客户端未请求子协议时 Accept 也会成功；协议版本协商要求必须匹配
		_ = ws.Close(websocket.StatusPolicyViolation, "subprotocol required: "+wsSubprotocol)
		return nil, nil
	}
	defer func() { _ = ws.CloseNow() }()

	// 首帧必须是 hello（读限 4KB；超时关闭）
	ws.SetReadLimit(4096)
	readCtx, cancel := context.WithTimeout(context.Background(), helloTimeout)
	defer cancel()
	_, data, err := ws.Read(readCtx)
	if err != nil {
		_ = ws.Close(websocket.StatusPolicyViolation, "hello required")
		return nil, nil
	}
	var hello multi.HelloMessage
	if err := json.Unmarshal(data, &hello); err != nil || hello.Type != "hello" {
		_ = ws.Close(websocket.StatusPolicyViolation, "first frame must be hello")
		return nil, nil
	}

	// 令牌鉴权（房间归属 + 成员状态；left 拒绝）
	member, apiErr := s.authenticateToken(ctx, hello.Token)
	if apiErr != nil || member.RoomID != request.RoomId {
		_ = ws.Close(websocket.StatusPolicyViolation, "unauthorized")
		return nil, nil
	}

	// 连接生效：成员 connected（清宽限）+ room.updated 事件广播（对端可见在线，08 §4.6）
	if err := s.markMemberConnected(ctx, request.RoomId, member.ID); err != nil {
		return nil, internalError(err)
	}

	// 注册/重放/实时流（阻塞直到断开；返回 nil 由 strict handler 正常结束）
	conn := hub.NewConn(s.hub, ws, request.RoomId, *member, hello.LastSequence)
	conn.Serve()
	return nil, nil
}

// markMemberConnected 成员连接状态落地 + room.updated 事件（事务内取号入库）。
func (s *Server) markMemberConnected(ctx context.Context, roomID, memberID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
		ID:         memberID,
		Status:     string(multi.MemberStatusConnected),
		GraceUntil: pgtype.Timestamptz{},
	}); err != nil {
		return internalError(err)
	}
	room, err := q.GetRoomForUpdate(ctx, roomID)
	if err != nil {
		return internalError(err)
	}
	members, err := q.ListMembers(ctx, roomID)
	if err != nil {
		return internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:  multi.RoomFormat(room.Format),
		Members: multi.MemberViews(members),
	}); err != nil {
		return internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return internalError(err)
	}
	s.publish(roomID)
	return nil
}
