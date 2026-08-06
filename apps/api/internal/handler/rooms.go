// Package handler 实现 oapi-codegen 生成的 strict server interface。
//
// 本文件是 Phase 1（契约与数据层）的临时占位：OpenAPI 已声明全部 10 个
// 多人端点，oapi-codegen 生成的 StrictServerInterface 要求 Server 实现它们，
// 而业务逻辑按计划在 Phase 2 落地。当前统一返回 501（UNSUPPORTED_CONTENT_TYPE，
// 沿用既有 501 错误码语义），Phase 2 逐个替换为真实实现。
package handler

import (
	"context"
	"net/http"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

// roomsNotImplemented 返回多人端点占位错误（Phase 1 契约先行，逻辑 Phase 2 落地）。
func roomsNotImplemented() *ApiError {
	return &ApiError{
		Status:  http.StatusNotImplemented,
		Code:    codeUnsupportedContentType,
		Message: "多人模式尚未实现（见 docs/develop_plan/multiplayer_mode）。",
	}
}

// RoomsCreate 创建房间（Phase 2 落地）。
func (s *Server) RoomsCreate(ctx context.Context, _ openapi.RoomsCreateRequestObject) (openapi.RoomsCreateResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsGetInfo 公开房间预检（Phase 2 落地）。
func (s *Server) RoomsGetInfo(ctx context.Context, _ openapi.RoomsGetInfoRequestObject) (openapi.RoomsGetInfoResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsJoin 加入房间（Phase 2 落地）。
func (s *Server) RoomsJoin(ctx context.Context, _ openapi.RoomsJoinRequestObject) (openapi.RoomsJoinResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsGetSnapshot 房间快照与事件重放（Phase 2 落地）。
func (s *Server) RoomsGetSnapshot(ctx context.Context, _ openapi.RoomsGetSnapshotRequestObject) (openapi.RoomsGetSnapshotResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsSetReady 就绪（Phase 2/3 落地）。
func (s *Server) RoomsSetReady(ctx context.Context, _ openapi.RoomsSetReadyRequestObject) (openapi.RoomsSetReadyResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsRematch 确认再来一局（Phase 3 落地）。
func (s *Server) RoomsRematch(ctx context.Context, _ openapi.RoomsRematchRequestObject) (openapi.RoomsRematchResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsSubmitGuess 提交猜测（Phase 3 落地）。
func (s *Server) RoomsSubmitGuess(ctx context.Context, _ openapi.RoomsSubmitGuessRequestObject) (openapi.RoomsSubmitGuessResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsLeave 离开房间（Phase 2/3 落地）。
func (s *Server) RoomsLeave(ctx context.Context, _ openapi.RoomsLeaveRequestObject) (openapi.RoomsLeaveResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsClose 房主关闭大厅房间（Phase 2 落地）。
func (s *Server) RoomsClose(ctx context.Context, _ openapi.RoomsCloseRequestObject) (openapi.RoomsCloseResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsConnectWs WebSocket 事件通道（Phase 4 落地）。
func (s *Server) RoomsConnectWs(ctx context.Context, _ openapi.RoomsConnectWsRequestObject) (openapi.RoomsConnectWsResponseObject, error) {
	return nil, roomsNotImplemented()
}
