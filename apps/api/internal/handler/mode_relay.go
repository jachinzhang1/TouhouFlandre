package handler

import (
	"context"
	"encoding/json"
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

type relayGuessModule struct{}

func (relayGuessModule) SubmitGuess(ctx context.Context, s *Server, q *repo.Queries, input submitGuessInput) (submitGuessResult, error) {
	request := input.request
	member := input.member
	room := input.room
	round := input.round
	match := input.match
	now := s.now()
	fields := multi.FieldsForMatch(match)
	storageFields := multi.StorageFieldsForMatch(match)
	maxTurnsPerPlayer := multi.MaxGuessesForMatch(match)

	switch round.Status {
	case string(multi.RoundStatusEnded):
		return submitGuessResult{}, roundEndedWithResult(round)
	case string(multi.RoundStatusCountdown):
		return submitGuessResult{}, roundNotActiveError("本局尚未开始。")
	case string(multi.RoundStatusPlaying):
		if !now.Before(round.Deadline.Time) {
			if _, err := multi.CompleteRoundTx(ctx, q, room, round, match, 0, now, s.timing); err != nil {
				return submitGuessResult{}, internalError(err)
			}
			chatChanged, err := multi.AppendLegacyRelayRoundAnnouncement(ctx, q, s.announcements, round, match, 0, now)
			if err != nil {
				return submitGuessResult{}, internalError(err)
			}
			return submitGuessResult{commit: true, publish: true, chatChanged: chatChanged}, roundNotActiveError("本局已超时（按平局结算）。")
		}
		if now.Before(round.StartsAt.Time) {
			return submitGuessResult{}, roundNotActiveError("本局尚未到开猜时间。")
		}
	default:
		return submitGuessResult{}, roundNotActiveError("本局不可猜测。")
	}

	existing, err := q.GetTurnByIdempotencyKey(ctx, repo.GetTurnByIdempotencyKeyParams{
		RoundID:        round.ID,
		MemberID:       member.ID,
		IdempotencyKey: pgtype.Text{String: request.Body.IdempotencyKey, Valid: true},
	})
	if err == nil {
		response, err := s.relayTurnAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, round.AnswerID, existing, fields)
		return submitGuessResult{response: response, commit: true}, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return submitGuessResult{}, internalError(err)
	}

	expiredOwnTurn := false
	for multi.RelayTurnExpired(round, now) {
		result, err := multi.SettleExpiredRelayTurnTx(ctx, q, room, round, match, now, s.timing)
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		if result.ExpiredSlot == multi.MemberSeat(member) {
			expiredOwnTurn = true
		}
		round = result.Round
		if result.RoundEnded {
			chatChanged, err := multi.AppendLegacyRelayRoundAnnouncement(ctx, q, s.announcements, round, match, result.WinnerSlot, now)
			if err != nil {
				return submitGuessResult{}, internalError(err)
			}
			return submitGuessResult{commit: true, publish: true, chatChanged: chatChanged}, turnExpiredError("本轮已超时空过，本局已结束。")
		}
	}
	if expiredOwnTurn {
		return submitGuessResult{commit: true, publish: true}, turnExpiredError("本轮已超时空过。")
	}
	if !round.TurnSlot.Valid || int(round.TurnSlot.Int32) != multi.MemberSeat(member) {
		return submitGuessResult{}, notYourTurnError()
	}

	memberTurnCount, err := q.CountTurnsForRoundMember(ctx, repo.CountTurnsForRoundMemberParams{RoundID: round.ID, MemberID: member.ID})
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	if int(memberTurnCount) >= maxTurnsPerPlayer {
		return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局轮次机会已用尽。"}
	}

	policy, err := game.ParseAnswerMatchPolicy(match.AnswerMatchPolicy)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	guessChar, statuses, matchKind, isCorrect, apiErr := s.computeFeedback(ctx, q, match.CatalogVersion, round.AnswerID, request.Body.GuessId, policy, storageFields)
	if apiErr != nil {
		return submitGuessResult{}, apiErr
	}
	if err := multi.ValidateStoredStatuses(match, statuses); err != nil {
		return submitGuessResult{}, internalError(err)
	}
	statusesJSON, err := json.Marshal(statuses)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	turnCount, err := q.CountTurnsForRound(ctx, round.ID)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	turnIndex := int(turnCount) + 1
	turn, err := q.InsertTurn(ctx, repo.InsertTurnParams{
		ID:             multi.NewID(),
		RoundID:        round.ID,
		MemberID:       member.ID,
		TurnIndex:      int32(turnIndex),
		Kind:           string(multi.RelayTurnKindGuess),
		GuessID:        pgtype.Text{String: guessChar.ID, Valid: true},
		Statuses:       statusesJSON,
		IsCorrect:      isCorrect,
		IdempotencyKey: pgtype.Text{String: request.Body.IdempotencyKey, Valid: true},
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			existing, readErr := q.GetTurnByIdempotencyKey(ctx, repo.GetTurnByIdempotencyKeyParams{
				RoundID:        round.ID,
				MemberID:       member.ID,
				IdempotencyKey: pgtype.Text{String: request.Body.IdempotencyKey, Valid: true},
			})
			if readErr != nil {
				return submitGuessResult{}, internalError(readErr)
			}
			response, err := s.relayTurnAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, round.AnswerID, existing, fields)
			return submitGuessResult{response: response, commit: true}, err
		}
		if isRelayDuplicateGuess(err) {
			return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "本局已猜过该角色。"}
		}
		return submitGuessResult{}, mapRoomWriteError(err)
	}

	guessSequence, err := nextGuessSequence(ctx, q, round.ID, member.ID)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	if _, err := q.InsertGuess(ctx, repo.InsertGuessParams{
		ID:             multi.NewID(),
		RoundID:        round.ID,
		MemberID:       member.ID,
		Sequence:       int32(guessSequence),
		GuessID:        guessChar.ID,
		Statuses:       statusesJSON,
		IsCorrect:      isCorrect,
		IdempotencyKey: request.Body.IdempotencyKey,
	}); err != nil {
		if isRaceDuplicateGuess(err) {
			return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "本局已猜过该角色。"}
		}
		return submitGuessResult{}, mapRoomWriteError(err)
	}

	counts, membersBySlot, err := multi.RelayTurnCounts(ctx, q, room.ID, round.ID)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	memberSlot := multi.MemberSeat(member)
	advance := multi.AdvanceRelayTurn(isCorrect, memberSlot, counts, maxTurnsPerPlayer)
	var nextTurnMemberID *string
	var nextTurnSlot *int
	var nextTurnDeadline *time.Time
	if !advance.RoundEnded {
		nextSlot := advance.NextTurnSlot
		deadline := now.Add(time.Duration(room.TurnSeconds) * time.Second)
		nextMember, ok := membersBySlot[nextSlot]
		if !ok {
			return submitGuessResult{}, internalError(errors.New("relay: next member missing"))
		}
		updated, err := q.UpdateRoundTurn(ctx, repo.UpdateRoundTurnParams{
			ID:           round.ID,
			TurnSlot:     pgtype.Int4{Int32: int32(nextSlot), Valid: true},
			TurnDeadline: pgtype.Timestamptz{Time: deadline, Valid: true},
		})
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		round = updated
		nextMemberID := nextMember.ID
		nextTurnMemberID = &nextMemberID
		nextTurnSlot = &nextSlot
		nextTurnDeadline = &deadline
	}

	row := multi.RelayTurnRow{
		Index:    int(turn.TurnIndex),
		MemberID: member.ID,
		Seat:     memberSlot,
		Kind:     multi.RelayTurnKindGuess,
		Guess:    ptr(multi.HydrateGuessResultViewWithFields(guessChar, statuses, isCorrect, fields, matchKind)),
	}
	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundSharedGuess, multi.RoundSharedGuessPayload{
		MatchIndex:       int(match.MatchIndex),
		RoundIndex:       int(round.RoundIndex),
		Row:              row,
		NextTurnMemberID: nextTurnMemberID,
		NextTurnSeat:     nextTurnSlot,
		NextTurnDeadline: nextTurnDeadline,
	}); err != nil {
		return submitGuessResult{}, internalError(err)
	}
	if advance.RoundEnded {
		if _, err := multi.CompleteRoundTx(ctx, q, room, round, match, advance.WinnerSlot, now, s.timing); err != nil {
			return submitGuessResult{}, internalError(err)
		}
	}
	chatChanged := false
	if advance.RoundEnded {
		chatChanged, err = multi.AppendLegacyRelayRoundAnnouncement(ctx, q, s.announcements, round, match, advance.WinnerSlot, now)
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
	}

	response, err := s.relayTurnAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, round.AnswerID, turn, fields)
	if err != nil {
		return submitGuessResult{}, err
	}
	return submitGuessResult{response: response, commit: true, publish: true, chatChanged: chatChanged}, nil
}

func nextGuessSequence(ctx context.Context, q *repo.Queries, roundID, memberID string) (int, error) {
	count, err := q.CountGuessesForRoundMember(ctx, repo.CountGuessesForRoundMemberParams{RoundID: roundID, MemberID: memberID})
	if err != nil {
		return 0, err
	}
	return int(count) + 1, nil
}

func (s *Server) relayTurnAcceptedResponse(ctx context.Context, roundIndex int, q *repo.Queries, catalogVersion, answerID string, turn repo.MultiTurn, fields []game.GuessField) (openapi.RoomsSubmitGuessResponseObject, error) {
	if turn.Kind != string(multi.RelayTurnKindGuess) {
		return nil, turnExpiredError("本轮已超时空过。")
	}
	return s.guessAcceptedResponse(ctx, roundIndex, q, catalogVersion, answerID, repo.MultiGuess{
		GuessID:   turn.GuessID.String,
		Statuses:  turn.Statuses,
		IsCorrect: turn.IsCorrect,
	}, fields)
}

func isRelayDuplicateGuess(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "multi_turn_round_id_guess_id_key"
}

func isRaceDuplicateGuess(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "multi_guess_round_id_member_id_guess_id_key"
}

func notYourTurnError() *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeNotYourTurn, Message: "还没轮到你提交猜测。"}
}

func turnExpiredError(message string) *ApiError {
	return &ApiError{Status: http.StatusConflict, Code: codeTurnExpired, Message: message}
}

func ptr[T any](value T) *T {
	return &value
}
