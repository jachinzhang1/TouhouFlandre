package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

type submitGuessInput struct {
	request openapi.RoomsSubmitGuessRequestObject
	member  repo.MultiMember
	room    repo.MultiRoom
	round   repo.MultiRound
	match   repo.MultiMatch
}

type submitGuessResult struct {
	response openapi.RoomsSubmitGuessResponseObject
	commit   bool
	publish  bool
}

type guessModeModule interface {
	SubmitGuess(context.Context, *Server, *repo.Queries, submitGuessInput) (submitGuessResult, error)
}

var guessModeModules = map[multi.MultiplayerMode]guessModeModule{
	multi.MultiplayerModeRace:  raceGuessModule{},
	multi.MultiplayerModeRelay: relayGuessModule{},
}

type raceGuessModule struct{}

func (raceGuessModule) SubmitGuess(ctx context.Context, s *Server, q *repo.Queries, input submitGuessInput) (submitGuessResult, error) {
	request := input.request
	member := input.member
	room := input.room
	round := input.round
	match := input.match
	fields := multi.FieldsForMatch(match)
	storageFields := multi.StorageFieldsForMatch(match)
	maxGuesses := multi.MaxGuessesForMatch(match)

	guessChar, statuses, isCorrect, apiErr := s.computeFeedback(ctx, q, match.CatalogVersion, round.AnswerID, request.Body.GuessId, storageFields)
	if apiErr != nil {
		return submitGuessResult{}, apiErr
	}
	switch round.Status {
	case string(multi.RoundStatusEnded):
		if isCorrect {
			return submitGuessResult{}, roundEndedWithResult(round)
		}
		return submitGuessResult{}, roundNotActiveError("本局已结束。")
	case string(multi.RoundStatusCountdown):
		return submitGuessResult{}, roundNotActiveError("本局尚未开始。")
	case string(multi.RoundStatusPlaying):
		if !s.now().Before(round.Deadline.Time) {
			if _, err := multi.CompleteRoundTx(ctx, q, room, round, match, 0, s.now(), s.timing); err != nil {
				return submitGuessResult{}, internalError(err)
			}
			return submitGuessResult{commit: true, publish: true}, roundNotActiveError("本局已超时（按平局结算）。")
		}
		if s.now().Before(round.StartsAt.Time) {
			return submitGuessResult{}, roundNotActiveError("本局尚未到开猜时间。")
		}
	default:
		return submitGuessResult{}, roundNotActiveError("本局不可猜测。")
	}

	existing, err := q.GetGuessByIdempotencyKey(ctx, repo.GetGuessByIdempotencyKeyParams{
		RoundID: round.ID, MemberID: member.ID, IdempotencyKey: request.Body.IdempotencyKey,
	})
	if err == nil {
		response, err := s.guessAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, existing, fields)
		return submitGuessResult{response: response, commit: true}, err
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return submitGuessResult{}, internalError(err)
	}

	count, err := q.CountGuessesForRoundMember(ctx, repo.CountGuessesForRoundMemberParams{
		RoundID: round.ID, MemberID: member.ID,
	})
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	if int(count) >= maxGuesses {
		return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局猜测次数已用尽。"}
	}
	sequence := int(count) + 1

	statusesJSON, err := json.Marshal(statuses)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	_, err = q.InsertGuess(ctx, repo.InsertGuessParams{
		ID:             multi.NewID(),
		RoundID:        round.ID,
		MemberID:       member.ID,
		Sequence:       int32(sequence),
		GuessID:        guessChar.ID,
		Statuses:       statusesJSON,
		IsCorrect:      isCorrect,
		IdempotencyKey: request.Body.IdempotencyKey,
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "multi_guess_round_id_member_id_guess_id_key" {
			return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "本局已猜过该角色。"}
		}
		return submitGuessResult{}, mapRoomWriteError(err)
	}

	if err := multi.AppendEvent(ctx, q, room.ID, multi.EventRoundOpponentGuess, multi.RoundGuessPayload{
		RoundID:    round.ID,
		MemberID:   member.ID,
		GuessID:    guessChar.ID,
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(round.RoundIndex),
		MemberSlot: multi.MemberSlot(member),
		RowIndex:   sequence,
		Statuses:   statuses,
	}); err != nil {
		return submitGuessResult{}, internalError(err)
	}

	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return submitGuessResult{}, internalError(err)
	}
	opponentID := ""
	for _, m := range members {
		if m.ID != member.ID {
			opponentID = m.ID
			break
		}
	}
	opponentCount := int64(0)
	if opponentID != "" {
		opponentCount, err = q.CountGuessesForRoundMember(ctx, repo.CountGuessesForRoundMemberParams{
			RoundID: round.ID, MemberID: opponentID,
		})
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
	}
	winnerSlot := 0
	if isCorrect {
		winnerSlot = multi.MemberSlot(member)
	}
	roundEnd := multi.SettleRoundEnd(winnerSlot, [2]int{sequence, int(opponentCount)}, maxGuesses, false)

	response, err := s.guessAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, repo.MultiGuess{
		GuessID:   guessChar.ID,
		Statuses:  statusesJSON,
		IsCorrect: isCorrect,
	}, fields)
	if err != nil {
		return submitGuessResult{}, err
	}
	if roundEnd.Ended {
		if _, err := multi.CompleteRoundTx(ctx, q, room, round, match, roundEnd.WinnerSlot, s.now(), s.timing); err != nil {
			return submitGuessResult{}, internalError(err)
		}
	}
	return submitGuessResult{response: response, commit: true, publish: true}, nil
}
