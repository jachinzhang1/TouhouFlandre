package handler

import (
	"context"
	"errors"
	"math"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func (s *Server) RoomsSendMessage(ctx context.Context, request openapi.RoomsSendMessageRequestObject) (openapi.RoomsSendMessageResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少成员身份。")
	}
	if !s.rollout.ChatSendEnabled {
		multi.DefaultMetrics.IncChatRejected(string(codeChatSendForbidden))
		return nil, &ApiError{Status: http.StatusForbidden, Code: codeChatSendForbidden, Message: "聊天发送仍在灰度中，当前暂未开放。"}
	}
	if request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "缺少聊天消息。"}
	}
	normalized, err := multi.NormalizeChatInput(
		request.Body.ClientMessageId,
		multi.ChatKind(request.Body.Kind),
		request.Body.Content,
	)
	if err != nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeChatMessageInvalid, Message: "聊天消息格式不合法。"}
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
	if apiErr := validateChatRoom(room, s.now()); apiErr != nil {
		return nil, apiErr
	}
	current, err := q.GetMemberForUpdate(ctx, member.ID)
	if err != nil || current.RoomID != request.RoomId {
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, internalError(err)
		}
		return nil, guestUnauthorized("成员身份已失效。")
	}
	if current.Status != string(multi.MemberStatusConnected) {
		return nil, &ApiError{Status: http.StatusForbidden, Code: codeChatSendForbidden, Message: "当前成员不可发送聊天消息。"}
	}
	channel, validRole := multi.ChatChannelForRole(current.Role)
	if !validRole {
		return nil, &ApiError{Status: http.StatusForbidden, Code: codeChatSendForbidden, Message: "当前成员不可发送聊天消息。"}
	}
	clientMessageID := pgtype.UUID{Bytes: [16]byte(normalized.ClientMessageID), Valid: true}
	existing, err := q.GetChatMessageByIdempotency(ctx, repo.GetChatMessageByIdempotencyParams{
		RoomID: request.RoomId, SenderMemberID: current.ID, ClientMessageID: clientMessageID,
	})
	if err == nil {
		if existing.Kind != string(normalized.Kind) || existing.Content != normalized.Content {
			return nil, &ApiError{Status: http.StatusConflict, Code: codeChatIdemConflict, Message: "该幂等键已用于另一条消息。"}
		}
		return openapi.RoomsSendMessage200JSONResponse(s.toOpenAPIChatMessage(existing, room)), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, internalError(err)
	}

	now := s.now().UTC()
	consumed := multi.ConsumeChatRate(
		chatBucketState(current.ChatRateTokens, current.ChatRateRefilledAt),
		chatBucketState(room.ChatRateTokens, room.ChatRateRefilledAt),
		s.chatRate,
		now,
	)
	if !consumed.Allowed {
		multi.DefaultMetrics.IncChatRejected(string(codeRateLimited))
		retryMs := max(1, int(math.Ceil(float64(consumed.RetryAfter)/float64(time.Millisecond))))
		retrySeconds := max(1, int(math.Ceil(consumed.RetryAfter.Seconds())))
		return openapi.RoomsSendMessage429JSONResponse{
			Body: openapi.RateLimitedErrorResponse{
				Code: openapi.RateLimitedErrorResponseCode(codeRateLimited), Error: "发送过于频繁，请稍后再试。", RetryAfterMs: retryMs,
			},
			Headers: openapi.RoomsSendMessage429ResponseHeaders{RetryAfter: &retrySeconds},
		}, nil
	}
	refilledAt := pgtype.Timestamptz{Time: consumed.RefilledAt, Valid: true}
	if err := q.UpdateRoomChatRate(ctx, repo.UpdateRoomChatRateParams{
		RoomID: request.RoomId, Tokens: pgtype.Float8{Float64: consumed.RoomTokens, Valid: true}, RefilledAt: refilledAt,
	}); err != nil {
		return nil, internalError(err)
	}
	if err := q.UpdateMemberChatRate(ctx, repo.UpdateMemberChatRateParams{
		MemberID: current.ID, Tokens: pgtype.Float8{Float64: consumed.MemberTokens, Valid: true}, RefilledAt: refilledAt,
	}); err != nil {
		return nil, internalError(err)
	}
	position, err := q.IncrementRoomChatSeq(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	created, err := q.InsertChatMessage(ctx, repo.InsertChatMessageParams{
		ID: newSessionID(), RoomID: request.RoomId, Position: position,
		SenderMemberID: current.ID, SenderDisplayName: current.DisplayName,
		SenderRole: current.Role, SenderSeat: current.Seat, ClientMessageID: clientMessageID,
		Kind: string(normalized.Kind), Content: normalized.Content, Channel: string(channel),
		CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	multi.DefaultMetrics.IncChatMessage(created.Channel, created.Kind)
	s.publishChat(created)
	return openapi.RoomsSendMessage200JSONResponse(s.toOpenAPIChatMessage(created, room)), nil
}

func (s *Server) RoomsListMessages(ctx context.Context, request openapi.RoomsListMessagesRequestObject) (openapi.RoomsListMessagesResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少成员身份。")
	}
	if request.Params.After != nil && request.Params.Before != nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "after 与 before 不能同时提供。"}
	}
	limit := multi.ChatHistoryDefaultLimit
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}
	if limit < 1 || limit > multi.ChatHistoryMaxLimit {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "limit 超出允许范围。"}
	}
	room, err := s.q.GetRoom(ctx, request.RoomId)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, roomNotFound()
		}
		return nil, internalError(err)
	}
	if apiErr := validateChatRoom(room, s.now()); apiErr != nil {
		return nil, apiErr
	}
	current, err := s.q.GetMember(ctx, member.ID)
	if err != nil || current.RoomID != request.RoomId {
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, internalError(err)
		}
		return nil, guestUnauthorized("成员身份已失效。")
	}
	if current.Status == string(multi.MemberStatusLeft) && room.Status != string(multi.RoomStatusFinished) {
		return nil, guestUnauthorized("成员不再具有聊天历史访问权限。")
	}
	if _, validRole := multi.ChatChannelForRole(current.Role); !validRole {
		return nil, guestUnauthorized("成员身份无效。")
	}

	cutoff := pgtype.Timestamptz{Time: s.now().Add(-s.chatRetention), Valid: true}
	bounds, err := s.q.GetChatReplayBounds(ctx, repo.GetChatReplayBoundsParams{RoomID: room.ID, Cutoff: cutoff})
	if err != nil {
		return nil, internalError(err)
	}
	if request.Params.After != nil {
		return s.listChatAfter(ctx, room, current, bounds, cutoff, *request.Params.After, limit)
	}
	if request.Params.Before != nil {
		return s.listChatBefore(ctx, room, current, bounds, cutoff, *request.Params.Before, limit)
	}
	return s.listInitialChat(ctx, room, current, bounds, cutoff, limit)
}

func (s *Server) listChatAfter(ctx context.Context, room repo.MultiRoom, viewer repo.MultiMember, bounds repo.GetChatReplayBoundsRow, cutoff pgtype.Timestamptz, cursor string, limit int) (openapi.RoomsListMessagesResponseObject, error) {
	position, err := s.chatCursor.Decode(cursor, room.ID, room.CreatedAt.Time, multi.ChatCursorAfter)
	if err != nil {
		return nil, chatCursorInvalid()
	}
	if position > room.ChatSeq {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeChatCursorAhead, Message: "聊天 cursor 超过服务端水位。"}
	}
	if chatHistoryUnavailable(position, room.ChatSeq, bounds.MinPosition) {
		return s.chatResyncResponse(room, bounds), nil
	}
	rows, err := s.q.ListChatMessagesAfter(ctx, repo.ListChatMessagesAfterParams{
		RoomID: room.ID, AfterPosition: position, HighPosition: room.ChatSeq, Cutoff: cutoff,
	})
	if err != nil {
		multi.DefaultMetrics.IncChatProjectionFailure("history")
		return nil, internalError(err)
	}
	messages := make([]openapi.ChatMessage, 0, min(limit, len(rows)))
	scanned := position
	for _, row := range rows {
		scanned = row.Position
		if multi.CanViewChatChannel(viewer.Role, row.Channel) {
			messages = append(messages, s.toOpenAPIChatMessage(row, room))
			if len(messages) == limit {
				break
			}
		}
	}
	scannedCursor := s.chatCursor.Encode(room.ID, room.CreatedAt.Time, scanned, multi.ChatCursorAfter)
	return openapi.RoomsListMessages200JSONResponse{
		Messages: messages, HasMore: scanned < room.ChatSeq, ScannedCursor: &scannedCursor,
	}, nil
}

func (s *Server) listInitialChat(ctx context.Context, room repo.MultiRoom, viewer repo.MultiMember, bounds repo.GetChatReplayBoundsRow, cutoff pgtype.Timestamptz, limit int) (openapi.RoomsListMessagesResponseObject, error) {
	rows, err := s.q.ListChatMessagesBefore(ctx, repo.ListChatMessagesBeforeParams{
		RoomID: room.ID, BeforePosition: room.ChatSeq + 1, Cutoff: cutoff,
	})
	if err != nil {
		multi.DefaultMetrics.IncChatProjectionFailure("history")
		return nil, internalError(err)
	}
	messages, oldestScanned := s.projectChatBackwards(rows, viewer, room, limit)
	slices.Reverse(messages)
	scannedCursor := s.chatCursor.Encode(room.ID, room.CreatedAt.Time, room.ChatSeq, multi.ChatCursorAfter)
	hasMore := oldestScanned > 0 && bounds.MinPosition > 0 && oldestScanned > bounds.MinPosition
	response := openapi.RoomsListMessages200JSONResponse{
		Messages: messages, HasMore: hasMore, ScannedCursor: &scannedCursor,
	}
	if hasMore {
		beforeCursor := s.chatCursor.Encode(room.ID, room.CreatedAt.Time, oldestScanned, multi.ChatCursorBefore)
		response.BeforeCursor = &beforeCursor
	}
	return response, nil
}

func (s *Server) listChatBefore(ctx context.Context, room repo.MultiRoom, viewer repo.MultiMember, bounds repo.GetChatReplayBoundsRow, cutoff pgtype.Timestamptz, cursor string, limit int) (openapi.RoomsListMessagesResponseObject, error) {
	position, err := s.chatCursor.Decode(cursor, room.ID, room.CreatedAt.Time, multi.ChatCursorBefore)
	if err != nil || position > room.ChatSeq+1 {
		return nil, chatCursorInvalid()
	}
	if bounds.MinPosition > 0 && position < bounds.MinPosition {
		return s.chatResyncResponse(room, bounds), nil
	}
	rows, err := s.q.ListChatMessagesBefore(ctx, repo.ListChatMessagesBeforeParams{
		RoomID: room.ID, BeforePosition: position, Cutoff: cutoff,
	})
	if err != nil {
		multi.DefaultMetrics.IncChatProjectionFailure("history")
		return nil, internalError(err)
	}
	messages, oldestScanned := s.projectChatBackwards(rows, viewer, room, limit)
	slices.Reverse(messages)
	hasMore := oldestScanned > 0 && bounds.MinPosition > 0 && oldestScanned > bounds.MinPosition
	response := openapi.RoomsListMessages200JSONResponse{Messages: messages, HasMore: hasMore}
	if hasMore {
		beforeCursor := s.chatCursor.Encode(room.ID, room.CreatedAt.Time, oldestScanned, multi.ChatCursorBefore)
		response.BeforeCursor = &beforeCursor
	}
	return response, nil
}

func (s *Server) projectChatBackwards(rows []repo.MultiChatMessage, viewer repo.MultiMember, room repo.MultiRoom, limit int) ([]openapi.ChatMessage, int64) {
	messages := make([]openapi.ChatMessage, 0, min(limit, len(rows)))
	var oldestScanned int64
	for _, row := range rows {
		oldestScanned = row.Position
		if multi.CanViewChatChannel(viewer.Role, row.Channel) {
			messages = append(messages, s.toOpenAPIChatMessage(row, room))
			if len(messages) == limit {
				break
			}
		}
	}
	return messages, oldestScanned
}

func (s *Server) toOpenAPIChatMessage(row repo.MultiChatMessage, room repo.MultiRoom) openapi.ChatMessage {
	message := openapi.ChatMessage{
		MessageId: row.ID, RoomId: row.RoomID, SenderMemberId: row.SenderMemberID,
		SenderDisplayName: row.SenderDisplayName, SenderRole: openapi.ChatSenderRole(row.SenderRole),
		Kind: openapi.ChatKind(row.Kind), Content: row.Content, Channel: openapi.ChatChannel(row.Channel),
		Cursor:    s.chatCursor.Encode(room.ID, room.CreatedAt.Time, row.Position, multi.ChatCursorAfter),
		CreatedAt: row.CreatedAt.Time,
	}
	if row.SenderSeat.Valid {
		seat := int(row.SenderSeat.Int32)
		message.SenderSeat = &seat
	}
	return message
}

func (s *Server) chatResyncResponse(room repo.MultiRoom, bounds repo.GetChatReplayBoundsRow) openapi.RoomsListMessages410JSONResponse {
	multi.DefaultMetrics.IncChatRejected(string(codeChatResyncRequired))
	oldest := room.ChatSeq
	if bounds.MinPosition > 0 {
		oldest = bounds.MinPosition - 1
	}
	return openapi.RoomsListMessages410JSONResponse{
		Code:                  openapi.ChatResyncRequiredResponseCode(codeChatResyncRequired),
		Error:                 "聊天历史已超出保留范围，请重新同步。",
		OldestAvailableCursor: s.chatCursor.Encode(room.ID, room.CreatedAt.Time, oldest, multi.ChatCursorAfter),
		HighWatermarkCursor:   s.chatCursor.Encode(room.ID, room.CreatedAt.Time, room.ChatSeq, multi.ChatCursorAfter),
	}
}

func chatHistoryUnavailable(position, high, minPosition int64) bool {
	if position >= high {
		return false
	}
	oldestBoundary := high
	if minPosition > 0 {
		oldestBoundary = minPosition - 1
	}
	return position < oldestBoundary
}

func chatCursorInvalid() *ApiError {
	return &ApiError{Status: http.StatusBadRequest, Code: codeChatCursorInvalid, Message: "聊天 cursor 无效。"}
}

func validateChatRoom(room repo.MultiRoom, now time.Time) *ApiError {
	expired := !room.ExpiresAt.Time.After(now)
	switch multi.RoomStatus(room.Status) {
	case multi.RoomStatusLobby, multi.RoomStatusFinished:
		if expired {
			return roomNotFound()
		}
	case multi.RoomStatusPlaying:
		return nil
	case multi.RoomStatusClosed:
		if expired {
			return roomNotFound()
		}
		return &ApiError{Status: http.StatusConflict, Code: codeRoomClosed, Message: "房间已关闭。"}
	default:
		return roomNotFound()
	}
	return nil
}

func chatBucketState(tokens pgtype.Float8, refilledAt pgtype.Timestamptz) multi.ChatBucketState {
	state := multi.ChatBucketState{}
	if tokens.Valid {
		value := tokens.Float64
		state.Tokens = &value
	}
	if refilledAt.Valid {
		value := refilledAt.Time
		state.RefilledAt = &value
	}
	return state
}
