// Package handler 实现 oapi-codegen 生成的 strict server interface。
//
// 本文件为多人房间与大厅端点（Phase 2）：创建/预检/加入/快照/就绪/离开/关闭。
// 鉴权由 RoomGuardMiddleware（auth.go）完成，handler 经 GuestMemberFromContext 取成员。
// rematch/guess/ws 仍为 501 占位（Phase 3/4 落地）。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// ---- 房间级命令错误映射（08 §7.2） ----

func roomNotFound() *ApiError {
	return &ApiError{Status: http.StatusNotFound, Code: codeRoomNotFound, Message: "房间不存在或已关闭。"}
}

func roomClosed() *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeRoomClosed, Message: "房间状态不允许该操作。"}
}

func roomFull() *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeRoomFull, Message: "房间已满。"}
}

// ---- 公共辅助 ----

var validRoomFormats = map[multi.RoomFormat]bool{
	multi.RoomFormatBO1: true,
	multi.RoomFormatBO3: true,
	multi.RoomFormatBO5: true,
	multi.RoomFormatBO7: true,
}

func toOpenAPIMemberView(m multi.MemberView) openapi.MemberView {
	return openapi.MemberView{
		Slot:        m.Slot,
		DisplayName: m.DisplayName,
		Status:      openapi.MemberStatus(m.Status),
		Ready:       m.Ready,
	}
}

func memberViewsFromRows(rows []repo.MultiMember) []multi.MemberView {
	views := make([]multi.MemberView, 0, len(rows))
	for _, m := range rows {
		views = append(views, multi.MemberView{
			Slot:        int(m.Slot),
			DisplayName: m.DisplayName,
			Status:      multi.MemberStatus(m.Status),
			Ready:       m.Ready,
		})
	}
	return views
}

func toEventEnvelopes(rows []repo.RoomEvent) ([]openapi.RoomEventEnvelope, error) {
	out := make([]openapi.RoomEventEnvelope, 0, len(rows))
	for _, row := range rows {
		var payload map[string]any
		if err := json.Unmarshal(row.Payload, &payload); err != nil {
			return nil, fmt.Errorf("decode room_event payload seq=%d: %w", row.Sequence, err)
		}
		out = append(out, openapi.RoomEventEnvelope{
			Type:       row.Type,
			EventId:    strconv.FormatInt(row.ID, 10),
			RoomId:     row.RoomID,
			Sequence:   int(row.Sequence),
			OccurredAt: row.OccurredAt.Time,
			Payload:    payload,
		})
	}
	return out, nil
}

// ---- RoomsCreate：创建房间（房主入座 slot 1） ----

// RoomsCreate 创建房间（08 §4.1/§5.1）。无鉴权。
func (s *Server) RoomsCreate(ctx context.Context, request openapi.RoomsCreateRequestObject) (openapi.RoomsCreateResponseObject, error) {
	if request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "缺少请求体。"}
	}
	format := multi.RoomFormat(request.Body.Format)
	if !validRoomFormats[format] {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidFormat, Message: "非法赛制。"}
	}
	displayName := ""
	if request.Body.DisplayName != nil {
		displayName = *request.Body.DisplayName
	}
	displayName = multi.NormalizeDisplayName(displayName)

	for attempt := 0; attempt < 5; attempt++ {
		response, err := s.createRoomTx(ctx, format, displayName)
		if err == nil {
			return response, nil
		}
		// 房间号冲突重试（multi_room.code UNIQUE）。
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "multi_room_code_key" {
			continue
		}
		return nil, err
	}
	return nil, internalError(errors.New("room code collision after retries"))
}

func (s *Server) createRoomTx(ctx context.Context, format multi.RoomFormat, displayName string) (openapi.RoomsCreateResponseObject, error) {
	roomID := newSessionID()
	token, err := multi.GenerateGuestToken()
	if err != nil {
		return nil, internalError(err)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.CreateRoom(ctx, repo.CreateRoomParams{
		ID:        roomID,
		Code:      multi.GenerateRoomCode(),
		Format:    string(format),
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(s.lobbyTTL), Valid: true},
	})
	if err != nil {
		return nil, mapRoomWriteError(err)
	}
	member, err := q.CreateMember(ctx, repo.CreateMemberParams{
		ID:          newSessionID(),
		RoomID:      roomID,
		Slot:        1,
		DisplayName: displayName,
		TokenHash:   multi.HashToken(token),
	})
	if err != nil {
		return nil, mapRoomWriteError(err)
	}
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:  format,
		Members: memberViewsFromRows([]repo.MultiMember{member}),
	}); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsCreate201JSONResponse{
		RoomId:     roomID,
		RoomCode:   room.Code,
		GuestToken: openapi.GuestToken(token),
		Member:     toOpenAPIMemberView(memberViewsFromRows([]repo.MultiMember{member})[0]),
	}, nil
}

// ---- RoomsGetInfo：公开预检（加入前可见赛制） ----

// RoomsGetInfo 公开只读预检（08 §4.2）。无鉴权；与 join 共用按 IP 限流（中间件）。
func (s *Server) RoomsGetInfo(ctx context.Context, request openapi.RoomsGetInfoRequestObject) (openapi.RoomsGetInfoResponseObject, error) {
	code := multi.NormalizeRoomCode(request.RoomCode)
	room, err := s.q.GetRoomByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if roomStatusClosed(room.Status) {
		return nil, roomNotFound() // 已关闭 → ROOM_NOT_FOUND（08 §7.2）
	}
	members, err := s.q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsGetInfo200JSONResponse{
		RoomCode:    room.Code,
		Format:      openapi.RoomFormat(room.Format),
		Status:      openapi.RoomStatus(room.Status),
		MemberCount: len(members),
	}, nil
}

// ---- RoomsJoin：加入房间（入座 slot 2） ----

// RoomsJoin 加入房间（08 §4.1）。无鉴权；按 IP 限流（中间件）。
func (s *Server) RoomsJoin(ctx context.Context, request openapi.RoomsJoinRequestObject) (openapi.RoomsJoinResponseObject, error) {
	if request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "缺少请求体。"}
	}
	displayName := ""
	if request.Body.DisplayName != nil {
		displayName = *request.Body.DisplayName
	}
	displayName = multi.NormalizeDisplayName(displayName)
	return s.joinRoom(ctx, multi.NormalizeRoomCode(request.RoomCode), displayName)
}

func (s *Server) joinRoom(ctx context.Context, code, displayName string) (openapi.RoomsJoinResponseObject, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	// 大厅命令只锁房间行（§9.2 锁序纪律）。
	room, err := q.GetRoomByCodeForUpdate(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if roomStatusClosed(room.Status) {
		return nil, roomNotFound() // 已关闭 → ROOM_NOT_FOUND（08 §7.2）
	}
	if room.Status != string(multi.RoomStatusLobby) {
		return nil, roomClosed() // playing/finished → ROOM_CLOSED
	}
	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	if len(members) >= 2 {
		return nil, roomFull()
	}

	token, err := multi.GenerateGuestToken()
	if err != nil {
		return nil, internalError(err)
	}
	member, err := q.CreateMember(ctx, repo.CreateMemberParams{
		ID:          newSessionID(),
		RoomID:      room.ID,
		Slot:        2,
		DisplayName: displayName,
		TokenHash:   multi.HashToken(token),
	})
	if err != nil {
		return nil, mapRoomWriteError(err)
	}
	updated := append(members, member)
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:  multi.RoomFormat(room.Format),
		Members: memberViewsFromRows(updated),
	}); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsJoin201JSONResponse{
		RoomId:     room.ID,
		GuestToken: openapi.GuestToken(token),
		Member:     toOpenAPIMemberView(memberViewsFromRows([]repo.MultiMember{member})[0]),
	}, nil
}

// ---- RoomsGetSnapshot：快照 + 事件重放 ----

// RoomsGetSnapshot 房间快照与事件重放（08 §7.1/§7.3）。成员令牌（中间件鉴权）。
func (s *Server) RoomsGetSnapshot(ctx context.Context, request openapi.RoomsGetSnapshotRequestObject) (openapi.RoomsGetSnapshotResponseObject, error) {
	after := int64(0)
	if request.Params.After != nil {
		after = int64(*request.Params.After)
	}
	room, err := s.q.GetRoom(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	members, err := s.q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	events, err := s.q.ListEventsAfterSeq(ctx, repo.ListEventsAfterSeqParams{
		RoomID:   request.RoomId,
		Sequence: after,
	})
	if err != nil {
		return nil, internalError(err)
	}
	envelopes, err := toEventEnvelopes(events)
	if err != nil {
		return nil, internalError(err)
	}
	memberViews := make([]openapi.MemberView, 0, len(members))
	for _, view := range memberViewsFromRows(members) {
		memberViews = append(memberViews, toOpenAPIMemberView(view))
	}
	return openapi.RoomsGetSnapshot200JSONResponse(openapi.RoomSnapshot{
		RoomId:   room.ID,
		RoomCode: room.Code,
		Format:   openapi.RoomFormat(room.Format),
		Status:   openapi.RoomStatus(room.Status),
		Members:  memberViews,
		Events:   envelopes,
	}), nil
}

// ---- RoomsSetReady：就绪（幂等） ----

// RoomsSetReady 就绪（08 §6.1 lobby 段）。成员令牌；本阶段只置位并写 room.updated 事件
// （双方就绪 → 对局开始由 Phase 3 接管）。
func (s *Server) RoomsSetReady(ctx context.Context, request openapi.RoomsSetReadyRequestObject) (openapi.RoomsSetReadyResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.GetRoomForUpdate(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	switch room.Status {
	case string(multi.RoomStatusClosed):
		return nil, roomClosed()
	case string(multi.RoomStatusPlaying), string(multi.RoomStatusFinished):
		return nil, &ApiError{Status: http.StatusConflict, Code: codeMatchAlreadyStarted, Message: "对局已开始。"}
	}
	members, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	alreadyReady := false
	for _, m := range members {
		if m.ID == member.ID && m.Ready {
			alreadyReady = true
			break
		}
	}
	if alreadyReady {
		return openapi.RoomsSetReady204Response{}, tx.Commit(ctx) // 幂等：状态未变，不产生事件
	}
	if _, err := q.SetMemberReady(ctx, repo.SetMemberReadyParams{ID: member.ID, Ready: true}); err != nil {
		return nil, internalError(err)
	}
	after, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:  multi.RoomFormat(room.Format),
		Members: memberViewsFromRows(after),
	}); err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsSetReady204Response{}, tx.Commit(ctx)
}

// ---- RoomsLeave：离开（大厅释放 slot / 房主关闭房间） ----

// RoomsLeave 离开房间（08 §4.6 大厅路径）。成员令牌。
// 对局中的离开（弃赛判负）由 Phase 3 实现；本阶段非 lobby 一律 ROOM_CLOSED。
func (s *Server) RoomsLeave(ctx context.Context, request openapi.RoomsLeaveRequestObject) (openapi.RoomsLeaveResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.GetRoomForUpdate(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if room.Status != string(multi.RoomStatusLobby) {
		return nil, roomClosed() // playing/finished/closed：Phase 3 处理弃赛/关闭
	}
	if member.Slot == 1 {
		// 房主离开 → 房间关闭（reason=host_left）。
		if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{
			ID:        request.RoomId,
			ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(s.eventRetention), Valid: true},
		}); err != nil {
			return nil, mapRoomWriteError(err)
		}
		if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomClosed, multi.RoomClosedPayload{
			Reason: multi.RoomCloseReasonHostLeft,
		}); err != nil {
			return nil, internalError(err)
		}
		return openapi.RoomsLeave204Response{}, tx.Commit(ctx)
	}
	// 加入者离开 → 删除成员行释放 slot（房主 ready 保留），room.updated 全量刷新。
	if err := q.DeleteMember(ctx, member.ID); err != nil {
		return nil, internalError(err)
	}
	remaining, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:  multi.RoomFormat(room.Format),
		Members: memberViewsFromRows(remaining),
	}); err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsLeave204Response{}, tx.Commit(ctx)
}

// ---- RoomsClose：房主关闭大厅房间 ----

// RoomsClose 关闭大厅房间（08 §7.1）。仅房主（slot 1）令牌、仅 lobby 态；非房主 → 403。
func (s *Server) RoomsClose(ctx context.Context, request openapi.RoomsCloseRequestObject) (openapi.RoomsCloseResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if member.Slot != 1 {
		return nil, &ApiError{Status: http.StatusForbidden, Code: codeGuestUnauthorized, Message: "只有房主可以关闭房间。"}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.GetRoomForUpdate(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if room.Status != string(multi.RoomStatusLobby) {
		return nil, roomClosed()
	}
	if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{
		ID:        request.RoomId,
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(s.eventRetention), Valid: true},
	}); err != nil {
		return nil, mapRoomWriteError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomClosed, multi.RoomClosedPayload{
		Reason: multi.RoomCloseReasonHostLeft,
	}); err != nil {
		return nil, internalError(err)
	}
	return openapi.RoomsClose204Response{}, tx.Commit(ctx)
}

// ---- Phase 3/4 占位（契约先行，见 Phase 1 说明） ----

// roomsNotImplemented 返回多人端点占位错误（未到落地阶段的端点）。
func roomsNotImplemented() *ApiError {
	return &ApiError{
		Status:  http.StatusNotImplemented,
		Code:    codeUnsupportedContentType,
		Message: "该多人端点尚未实现（见 docs/develop_plan/multiplayer_mode）。",
	}
}

// RoomsRematch 确认再来一局（Phase 3 落地）。
func (s *Server) RoomsRematch(ctx context.Context, _ openapi.RoomsRematchRequestObject) (openapi.RoomsRematchResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsSubmitGuess 提交猜测（Phase 3 落地）。
func (s *Server) RoomsSubmitGuess(ctx context.Context, _ openapi.RoomsSubmitGuessRequestObject) (openapi.RoomsSubmitGuessResponseObject, error) {
	return nil, roomsNotImplemented()
}

// RoomsConnectWs WebSocket 事件通道（Phase 4 落地）。
func (s *Server) RoomsConnectWs(ctx context.Context, _ openapi.RoomsConnectWsRequestObject) (openapi.RoomsConnectWsResponseObject, error) {
	return nil, roomsNotImplemented()
}

// ---- 辅助 ----

func roomStatusClosed(status string) bool {
	return status == string(multi.RoomStatusClosed)
}

// mapRoomWriteError 写入冲突映射：唯一冲突（房间号/token 哈希等）→ 409，其余 → 500。
func mapRoomWriteError(err error) *ApiError {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return &ApiError{Status: http.StatusConflict, Code: codeRoomClosed, Message: "资源冲突，请重试。"}
	}
	return internalError(err)
}
