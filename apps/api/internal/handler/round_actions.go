package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func (s *Server) currentRoundCommandState(ctx context.Context, q *repo.Queries, roomID string, roundIndex int) (repo.MultiRoom, repo.MultiRound, repo.MultiMatch, *ApiError) {
	room, err := q.GetRoom(ctx, roomID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roomNotFound()
		}
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, internalError(err)
	}
	if room.Status != string(multi.RoomStatusPlaying) {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roomClosed()
	}

	round, err := q.GetCurrentRoundForUpdateByRoom(ctx, roomID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundNotActiveError("当前没有可操作的局。")
		}
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, internalError(err)
	}
	if int(round.RoundIndex) != roundIndex {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundNotActiveError("目标局不是当前局。")
	}

	match, err := q.GetMatchForUpdate(ctx, round.MatchID)
	if err != nil {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, internalError(err)
	}
	if round.Status == string(multi.RoundStatusEnded) {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundEndedWithResult(round)
	}
	if round.Status != string(multi.RoundStatusPlaying) {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundNotActiveError("本局尚未开始。")
	}
	if !s.now().Before(round.Deadline.Time) {
		// 超时权威结算由 sweeper 或猜测事务完成；本命令不得在返回错误时让 defer 回滚一份伪结算。
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundNotActiveError("本局已超时，正在结算。")
	}
	if s.now().Before(round.StartsAt.Time) {
		return repo.MultiRoom{}, repo.MultiRound{}, repo.MultiMatch{}, roundNotActiveError("本局尚未到开猜时间。")
	}
	return room, round, match, nil
}

func (s *Server) RoomsForfeitRound(ctx context.Context, request openapi.RoomsForfeitRoundRequestObject) (openapi.RoomsForfeitRoundResponseObject, error) {
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

	room, round, match, apiErr := s.currentRoundCommandState(ctx, q, request.RoomId, request.RoundIndex)
	if apiErr != nil {
		return nil, apiErr
	}
	if multi.MultiplayerMode(room.Mode) == multi.MultiplayerModeRace {
		if _, _, err := multi.ForfeitRaceRoundTx(ctx, q, room, round, match, member.ID, s.now(), s.timing); err != nil {
			if errors.Is(err, multi.ErrRaceRoundPlayerInactive) {
				return nil, roundNotActiveError("你已放弃本局。")
			}
			return nil, internalError(err)
		}
	} else {
		winnerSlot := multi.OtherSlot(multi.MemberSeat(*member))
		if _, err := multi.CompleteRoundTx(ctx, q, room, round, match, winnerSlot, s.now(), s.timing, multi.MemberSeat(*member)); err != nil {
			return nil, internalError(err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsForfeitRound204Response{}, nil
}

func (s *Server) RoomsPassRelayTurn(ctx context.Context, request openapi.RoomsPassRelayTurnRequestObject) (openapi.RoomsPassRelayTurnResponseObject, error) {
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

	room, round, match, apiErr := s.currentRoundCommandState(ctx, q, request.RoomId, request.RoundIndex)
	if apiErr != nil {
		return nil, apiErr
	}
	if multi.MultiplayerMode(room.Mode) != multi.MultiplayerModeRelay {
		return nil, &ApiError{Status: http.StatusConflict, Code: codeInvalidRequest, Message: "只有接力模式可以主动空过。"}
	}
	now := s.now()
	expiredOwnTurn := false
	for multi.RelayTurnExpired(round, now) {
		result, err := multi.SettleExpiredRelayTurnTx(ctx, q, room, round, match, now, s.timing)
		if err != nil {
			return nil, internalError(err)
		}
		if result.ExpiredSlot == multi.MemberSeat(*member) {
			expiredOwnTurn = true
		}
		round = result.Round
		if result.RoundEnded {
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return nil, internalError(commitErr)
			}
			s.publish(request.RoomId)
			return nil, turnExpiredError("本轮已超时空过，本局已结算。")
		}
	}
	if expiredOwnTurn {
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return nil, internalError(commitErr)
		}
		s.publish(request.RoomId)
		return nil, turnExpiredError("本轮已超时空过。")
	}
	if !round.TurnSlot.Valid || int(round.TurnSlot.Int32) != multi.MemberSeat(*member) {
		return nil, notYourTurnError()
	}
	if _, err := multi.SettlePassedRelayTurnTx(ctx, q, room, round, match, *member, now, s.timing); err != nil {
		return nil, internalError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError(err)
	}
	s.publish(request.RoomId)
	return openapi.RoomsPassRelayTurn204Response{}, nil
}
