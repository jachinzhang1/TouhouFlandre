// Package handler 实现 oapi-codegen 生成的 strict server interface。
//
// 本文件为多人房间与大厅端点（Phase 2）：创建/预检/加入/快照/就绪/离开/关闭。
// 鉴权由 RoomGuardMiddleware（auth.go）完成，handler 经 GuestMemberFromContext 取成员。
// rematch/guess/ws 仍为 501 占位（Phase 3/4 落地）。
package handler

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
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
func spectatorReadOnly() *ApiError {
	return &ApiError{Status: http.StatusForbidden, Code: codeSpectatorReadOnly, Message: "观战席只能查看对局。"}
}

func requirePlayer(member *repo.MultiMember) *ApiError {
	if member == nil || !multi.IsPlayer(*member) {
		return spectatorReadOnly()
	}
	return nil
}

// ---- 公共辅助 ----

var validRoomFormats = map[multi.RoomFormat]bool{
	multi.RoomFormatBO1: true,
	multi.RoomFormatBO3: true,
	multi.RoomFormatBO5: true,
	multi.RoomFormatBO7: true,
}

func roomUpdatedPayload(room repo.MultiRoom, members []repo.MultiMember, spectatorCount int) multi.RoomUpdatedPayload {
	return multi.RoomUpdatedPayload{
		Format:         multi.RoomFormat(room.Format),
		Mode:           multi.MultiplayerMode(room.Mode),
		TurnSeconds:    int(room.TurnSeconds),
		Members:        multi.MemberViews(members),
		SpectatorCount: spectatorCount,
	}
}

func toOpenAPIMemberView(m multi.MemberView) openapi.MemberView {
	return openapi.MemberView{
		Slot:        m.Slot,
		DisplayName: m.DisplayName,
		Status:      openapi.MemberStatus(m.Status),
		Ready:       m.Ready,
	}
}

func toOpenAPIParticipantView(v multi.ParticipantView) openapi.ParticipantView {
	view := openapi.ParticipantView{
		Role:        openapi.ParticipantRole(v.Role),
		DisplayName: v.DisplayName,
		Status:      openapi.MemberStatus(v.Status),
	}
	if v.Slot != nil {
		view.Slot = v.Slot
	}
	return view
}

func joinRoleFor(room repo.MultiRoom, playerCount int, now time.Time) multi.ParticipantRole {
	if room.Status == string(multi.RoomStatusLobby) && playerCount < 2 {
		return multi.ParticipantRolePlayer
	}
	if room.Status == string(multi.RoomStatusClosed) {
		return ""
	}
	if room.Status == string(multi.RoomStatusFinished) && !now.Before(room.ExpiresAt.Time) {
		return ""
	}
	return multi.ParticipantRoleSpectator
}

func nextPlayerSlot(members []repo.MultiMember) (int32, bool) {
	used := map[int]bool{}
	for _, member := range members {
		used[multi.MemberSlot(member)] = true
	}
	for slot := 1; slot <= 2; slot++ {
		if !used[slot] {
			return int32(slot), true
		}
	}
	return 0, false
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
	mode := multi.MultiplayerModeRace
	if request.Body.Mode != nil {
		mode = multi.MultiplayerMode(*request.Body.Mode)
	}
	if !multi.ValidMultiplayerMode(mode) {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "非法多人玩法。"}
	}
	turnSeconds := int(s.timing.TurnSeconds / time.Second)
	if !multi.ValidTurnSeconds(turnSeconds) {
		turnSeconds = 60
	}
	if request.Body.TurnSeconds != nil {
		turnSeconds = int(*request.Body.TurnSeconds)
	}
	if !multi.ValidTurnSeconds(turnSeconds) {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "非法接力回合时限。"}
	}
	displayName := ""
	if request.Body.DisplayName != nil {
		displayName = *request.Body.DisplayName
	}
	displayName = multi.NormalizeDisplayName(displayName)
	version, characters, works, err := s.currentCatalogWithWorks(ctx)
	if err != nil {
		return nil, err
	}
	correction := normalizeQuestionScopeForCatalog(
		questionScopeFromOpenAPI(request.Body.QuestionScope),
		version,
		characters,
		works,
	)
	scope := correction.Config

	for attempt := 0; attempt < 5; attempt++ {
		response, err := s.createRoomTx(ctx, format, mode, turnSeconds, displayName, scope)
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

func (s *Server) createRoomTx(ctx context.Context, format multi.RoomFormat, mode multi.MultiplayerMode, turnSeconds int, displayName string, scope game.QuestionScopeConfig) (openapi.RoomsCreateResponseObject, error) {
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
	scopeJSON, err := questionScopeJSON(scope)
	if err != nil {
		return nil, internalError(err)
	}

	room, err := q.CreateRoom(ctx, repo.CreateRoomParams{
		ID:            roomID,
		Code:          multi.GenerateRoomCode(),
		Format:        string(format),
		Mode:          string(mode),
		TurnSeconds:   int32(turnSeconds),
		ExpiresAt:     timestamptz(s.now().Add(s.lobbyTTL)),
		QuestionScope: scopeJSON,
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
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, roomUpdatedPayload(room, []repo.MultiMember{member}, 0)); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(roomID)
	openapiScope := toOpenAPIQuestionScope(scope)
	return openapi.RoomsCreate201JSONResponse{
		RoomId:        roomID,
		RoomCode:      room.Code,
		GuestToken:    openapi.GuestToken(token),
		Viewer:        toOpenAPIParticipantView(multi.ParticipantViewFor(member)),
		QuestionScope: &openapiScope,
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
	if roomStatusClosed(room.Status) || (room.Status == string(multi.RoomStatusFinished) && !s.now().Before(room.ExpiresAt.Time)) {
		return nil, roomNotFound() // 已关闭/保留期过期 → ROOM_NOT_FOUND（08 §7.2）
	}
	members, err := s.q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	spectatorCount, err := s.q.CountSpectators(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	joinRole := joinRoleFor(room, len(members), s.now())
	scope, err := storedQuestionScopeFromJSON(room.QuestionScope)
	if err != nil {
		return nil, internalError(err)
	}
	openapiScope := toOpenAPIQuestionScope(scope)
	return openapi.RoomsGetInfo200JSONResponse{
		RoomCode:       room.Code,
		Format:         openapi.RoomFormat(room.Format),
		Mode:           openapi.MultiplayerMode(room.Mode),
		TurnSeconds:    openapi.RoomInfoTurnSeconds(room.TurnSeconds),
		Status:         openapi.RoomStatus(room.Status),
		MemberCount:    len(members),
		SpectatorCount: int(spectatorCount),
		JoinRole:       openapi.ParticipantRole(joinRole),
		QuestionScope:  &openapiScope,
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

	// 加入路径锁房间行；真正参与规则的玩家仍只有 slot 1/2。
	room, err := q.GetRoomByCodeForUpdate(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if roomStatusClosed(room.Status) || (room.Status == string(multi.RoomStatusFinished) && !s.now().Before(room.ExpiresAt.Time)) {
		return nil, roomNotFound()
	}
	players, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	role := joinRoleFor(room, len(players), s.now())
	if role == "" {
		return nil, roomClosed()
	}

	token, err := multi.GenerateGuestToken()
	if err != nil {
		return nil, internalError(err)
	}
	var participant repo.MultiMember
	if role == multi.ParticipantRolePlayer {
		slot, ok := nextPlayerSlot(players)
		if !ok {
			return nil, internalError(errors.New("no available player slot"))
		}
		participant, err = q.CreateMember(ctx, repo.CreateMemberParams{
			ID:          newSessionID(),
			RoomID:      room.ID,
			Slot:        slot,
			DisplayName: displayName,
			TokenHash:   multi.HashToken(token),
		})
	} else {
		participant, err = q.CreateSpectatorMember(ctx, repo.CreateSpectatorMemberParams{
			ID:          newSessionID(),
			RoomID:      room.ID,
			DisplayName: displayName,
			TokenHash:   multi.HashToken(token),
		})
	}
	if err != nil {
		return nil, mapRoomWriteError(err)
	}
	playersAfter, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	spectatorCount, err := q.CountSpectators(ctx, room.ID)
	if err != nil {
		return nil, internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoomUpdated, roomUpdatedPayload(room, playersAfter, int(spectatorCount))); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(room.ID)
	return openapi.RoomsJoin201JSONResponse{
		RoomId:     room.ID,
		GuestToken: openapi.GuestToken(token),
		Viewer:     toOpenAPIParticipantView(multi.ParticipantViewFor(participant)),
	}, nil
}

// ---- RoomsSetReady：就绪（幂等） ----

// RoomsSetReady 就绪（08 §6.1 lobby 段）。成员令牌；本阶段只置位并写 room.updated 事件
// （双方就绪 → 对局开始由 Phase 3 接管）。
func (s *Server) RoomsSetReady(ctx context.Context, request openapi.RoomsSetReadyRequestObject) (openapi.RoomsSetReadyResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if apiErr := requirePlayer(member); apiErr != nil {
		return nil, apiErr
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
	// 双方就绪且都 connected → 同一事务开局（绑版本、抽题、建 round 1；08 §6.1）
	bothReady := len(after) == 2 && after[0].Ready && after[1].Ready
	bothConnected := len(after) == 2 &&
		after[0].Status == string(multi.MemberStatusConnected) && after[1].Status == string(multi.MemberStatusConnected)
	if bothReady && bothConnected {
		if err := s.startMatchTx(ctx, q, room, multi.RoomFormat(room.Format)); err != nil {
			return nil, err
		}
	}
	spectatorCount, err := q.CountSpectators(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomUpdated, roomUpdatedPayload(room, after, int(spectatorCount))); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsSetReady204Response{}, nil
}

// ---- RoomsLeave：离开（大厅释放 slot / 房主关闭房间） ----

// RoomsLeave 离开房间（08 §4.6）。
// 大厅：房主 → 房间关闭（host_left）、加入者 → 删行释放 slot（房主 ready 保留）；
// 对局中：弃赛判对方胜（reason=forfeit，锁序 局→场→房间 由 ForfeitMemberMatch 保证）；
// 对局结束后：房间关闭（无继续对局的可能）。
func (s *Server) RoomsLeave(ctx context.Context, request openapi.RoomsLeaveRequestObject) (openapi.RoomsLeaveResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	room, err := s.q.GetRoom(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if room.Status == string(multi.RoomStatusPlaying) && multi.IsPlayer(*member) {
		if err := multi.ForfeitMemberMatch(ctx, s.pool, *member, multi.MatchEndReasonForfeit, s.now(), s.timing); err != nil {
			return nil, internalError(err)
		}
		s.publish(request.RoomId)
		return openapi.RoomsLeave204Response{}, nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	lockedRoom, err := q.GetRoomForUpdate(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if lockedRoom.Status == string(multi.RoomStatusClosed) {
		return nil, roomClosed()
	}
	if multi.IsSpectator(*member) {
		if err := s.markMemberLeftTx(ctx, q, lockedRoom, member); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError(err)
		}
		s.publish(request.RoomId)
		return openapi.RoomsLeave204Response{}, nil
	}
	switch lockedRoom.Status {
	case string(multi.RoomStatusPlaying):
		if err := tx.Rollback(ctx); err != nil {
			return nil, internalError(err)
		}
		if err := multi.ForfeitMemberMatch(ctx, s.pool, *member, multi.MatchEndReasonForfeit, s.now(), s.timing); err != nil {
			return nil, internalError(err)
		}
		s.publish(request.RoomId)
		return openapi.RoomsLeave204Response{}, nil
	case string(multi.RoomStatusFinished):
		if err := s.markMemberLeftTx(ctx, q, lockedRoom, member); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError(err)
		}
		s.publish(request.RoomId)
		return openapi.RoomsLeave204Response{}, nil
	}
	if multi.MemberSlot(*member) == 1 {
		if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{
			ID:        request.RoomId,
			ExpiresAt: timestamptz(s.now().Add(s.eventRetention)),
		}); err != nil {
			return nil, mapRoomWriteError(err)
		}
		if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomClosed, multi.RoomClosedPayload{
			Reason: multi.RoomCloseReasonHostLeft,
		}); err != nil {
			return nil, internalError(err)
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, internalError(err)
		}
		s.publish(request.RoomId)
		return openapi.RoomsLeave204Response{}, nil
	}
	if err := q.DeleteMember(ctx, member.ID); err != nil {
		return nil, internalError(err)
	}
	remaining, err := q.ListMembers(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	spectatorCount, err := q.CountSpectators(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomUpdated, roomUpdatedPayload(lockedRoom, remaining, int(spectatorCount))); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsLeave204Response{}, nil
}

func (s *Server) markMemberLeftTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, member *repo.MultiMember) error {
	if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
		ID:         member.ID,
		Status:     string(multi.MemberStatusLeft),
		GraceUntil: pgtype.Timestamptz{},
	}); err != nil {
		return internalError(err)
	}
	players, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return internalError(err)
	}
	spectatorCount, err := q.CountSpectators(ctx, room.ID)
	if err != nil {
		return internalError(err)
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoomUpdated, roomUpdatedPayload(room, players, int(spectatorCount))); err != nil {
		return internalError(err)
	}
	return nil
}

// ---- RoomsClose：房主关闭大厅房间 ----

// RoomsClose 关闭大厅房间（08 §7.1）。仅房主（slot 1）令牌、仅 lobby 态；非房主 → 403。
func (s *Server) RoomsClose(ctx context.Context, request openapi.RoomsCloseRequestObject) (openapi.RoomsCloseResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if apiErr := requirePlayer(member); apiErr != nil {
		return nil, apiErr
	}
	if multi.MemberSlot(*member) != 1 {
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
		ExpiresAt: timestamptz(s.now().Add(s.eventRetention)),
	}); err != nil {
		return nil, mapRoomWriteError(err)
	}
	if err := multi.AppendEvent(ctx, q, request.RoomId, multi.EventRoomClosed, multi.RoomClosedPayload{
		Reason: multi.RoomCloseReasonHostLeft,
	}); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsClose204Response{}, nil
}

// ---- Phase 4 占位（契约先行，见 Phase 1 说明） ----

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
