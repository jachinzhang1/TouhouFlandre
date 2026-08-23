package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
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

var guessCommandRoutes = map[core.CommandRoute]guessModeModule{
	core.CommandRouteRace:        raceGuessModule{},
	core.CommandRouteLegacyRelay: relayGuessModule{},
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
	rules := multi.RaceRulesForMatch(match)
	roundPlayer, err := q.GetRoundPlayer(ctx, repo.GetRoundPlayerParams{RoundID: round.ID, MemberID: member.ID})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return submitGuessResult{}, roundNotActiveError("你不在本局阵容中。")
		}
		return submitGuessResult{}, internalError(err)
	}
	if roundPlayer.Status != "active" {
		if roundPlayer.Status == "exhausted" {
			return submitGuessResult{}, &ApiError{Status: http.StatusConflict, Code: codeGuessLimitReached, Message: "本局猜测次数已用尽。"}
		}
		message := "你已放弃本局。"
		switch roundPlayer.Status {
		case "correct":
			message = "你已猜中本局。"
		case "timed_out":
			message = "本局已超时。"
		}
		return submitGuessResult{}, roundNotActiveError(message)
	}

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
			if _, err := multi.CompleteRaceRoundTx(ctx, q, room, round, match, "", s.now(), s.timing); err != nil {
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
		MemberSlot: multi.MemberSeat(member),
		RowIndex:   sequence,
		Statuses:   statuses,
	}); err != nil {
		return submitGuessResult{}, internalError(err)
	}

	scoredRace := rules.UsesPlacementScoring()
	var participationStatus *openapi.RaceRoundParticipantStatus
	var finishRank *int
	roundEnded := false
	if scoredRace && isCorrect {
		correctCount, err := q.CountCorrectRoundPlayers(ctx, round.ID)
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		updated, err := q.MarkRoundPlayerCorrect(ctx, repo.MarkRoundPlayerCorrectParams{RoundID: round.ID, MemberID: member.ID, FinishRank: pgtype.Int4{Int32: correctCount + 1, Valid: true}, CompletedAt: timestamptz(s.now())})
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		status := openapi.RaceRoundParticipantStatus(updated.Status)
		participationStatus = &status
		rank := int(updated.FinishRank.Int32)
		finishRank = &rank
	} else if scoredRace && int(count)+1 >= maxGuesses {
		if _, err := q.MarkRoundPlayerExhausted(ctx, repo.MarkRoundPlayerExhaustedParams{RoundID: round.ID, MemberID: member.ID, CompletedAt: timestamptz(s.now())}); err != nil {
			return submitGuessResult{}, internalError(err)
		}
		status := openapi.RaceRoundParticipantStatusExhausted
		participationStatus = &status
	}
	if scoredRace {
		activePlayers, err := q.ListActiveRoundPlayers(ctx, round.ID)
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		roundEnded = len(activePlayers) == 0
	} else {
		roundEnded = isCorrect
	}
	if !roundEnded && !scoredRace {
		counts, err := q.ListRoundPlayerGuessCounts(ctx, round.ID)
		if err != nil {
			return submitGuessResult{}, internalError(err)
		}
		roundEnded = len(counts) > 0
		for _, count := range counts {
			if int(count.GuessCount) < maxGuesses {
				roundEnded = false
				break
			}
		}
	}

	response, err := s.guessAcceptedResponse(ctx, request.RoundIndex, q, match.CatalogVersion, repo.MultiGuess{
		GuessID:   guessChar.ID,
		Statuses:  statusesJSON,
		IsCorrect: isCorrect,
	}, fields)
	if err != nil {
		return submitGuessResult{}, err
	}
	if scoredRace {
		accepted := response.(openapi.RoomsSubmitGuess200JSONResponse)
		accepted.ParticipationStatus = participationStatus
		accepted.FinishRank = finishRank
		response = accepted
	}
	if roundEnded {
		winnerMemberID := ""
		if isCorrect && !scoredRace {
			winnerMemberID = member.ID
		}
		if _, err := multi.CompleteRaceRoundTx(ctx, q, room, round, match, winnerMemberID, s.now(), s.timing); err != nil {
			return submitGuessResult{}, internalError(err)
		}
	}
	return submitGuessResult{response: response, commit: true, publish: true}, nil
}
