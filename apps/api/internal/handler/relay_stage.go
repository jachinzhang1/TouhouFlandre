package handler

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

func (s *Server) RoomsRelayEncounterAction(ctx context.Context, request openapi.RoomsRelayEncounterActionRequestObject) (openapi.RoomsRelayEncounterActionResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	if apiErr := requirePlayer(member); apiErr != nil {
		return nil, apiErr
	}
	if request.Body == nil {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "缺少请求体。"}
	}
	result, err := s.relayEncounters.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: request.RoomId, StageIndex: request.StageIndex, EncounterID: request.EncounterId,
		ActorMemberID: member.ID, Action: relayadapter.EncounterAction(request.Body.Action),
		GuessID: optionalString(request.Body.GuessId), IdempotencyKey: request.Body.IdempotencyKey,
	})
	if result.Changed {
		s.publish(request.RoomId)
	}
	if err != nil {
		return nil, mapRelayEncounterError(err)
	}
	var turn *openapi.RelayTurnRow
	if result.Turn != nil {
		row := openapi.RelayTurnRow{
			Index: result.Turn.Index, MemberId: result.Turn.MemberID, Seat: result.Turn.Seat,
			Kind: openapi.RelayTurnRowKind(result.Turn.Kind),
		}
		if result.Turn.Guess != nil {
			guess := toOpenAPIGuessResultView(*result.Turn.Guess)
			row.Guess = &guess
		}
		turn = &row
	}
	return openapi.RoomsRelayEncounterAction200JSONResponse{
		StageIndex: result.StageIndex, EncounterId: result.EncounterID, Accepted: result.Accepted,
		Ended: result.Ended, Turn: turn,
	}, nil
}

func (s *Server) relayEncounterForLegacyRound(ctx context.Context, roomID string, stageIndex int) (repo.MultiRelayEncounter, bool, error) {
	encounter, err := s.q.GetRelayEncounterForLegacyRound(ctx, repo.GetRelayEncounterForLegacyRoundParams{
		RoomID: roomID, StageIndex: int32(stageIndex),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return repo.MultiRelayEncounter{}, false, nil
	}
	return encounter, err == nil, err
}

func mapRelayEncounterError(err error) *ApiError {
	switch {
	case errors.Is(err, relaydomain.ErrEncounterNotFound):
		return &ApiError{Status: http.StatusNotFound, Code: codeEncounterNotFound, Message: "没有找到目标接力对局。"}
	case errors.Is(err, relaydomain.ErrNotEncounterPlayer):
		return &ApiError{Status: http.StatusConflict, Code: codeNotEncounterPlayer, Message: "你不是该接力对局的参赛者。"}
	case errors.Is(err, relaydomain.ErrNotYourTurn):
		return notYourTurnError()
	case errors.Is(err, relaydomain.ErrEncounterEnded):
		return &ApiError{Status: http.StatusConflict, Code: codeEncounterEnded, Message: "该接力对局已经结束。"}
	case errors.Is(err, relaydomain.ErrEncounterNotActive):
		return roundNotActiveError("该接力对局尚未开始。")
	case errors.Is(err, relaydomain.ErrTurnExpired):
		return turnExpiredError("本轮已超时空过。")
	case errors.Is(err, relaydomain.ErrInvalidGuess):
		return &ApiError{Status: http.StatusBadRequest, Code: codeInvalidGuess, Message: "该角色不在本局题库中。"}
	case errors.Is(err, relaydomain.ErrDuplicateGuess):
		return &ApiError{Status: http.StatusConflict, Code: codeDuplicateGuess, Message: "本局已猜过该角色。"}
	case errors.Is(err, relaydomain.ErrIdempotencyConflict):
		return &ApiError{Status: http.StatusConflict, Code: codeIdempotencyConflict, Message: "幂等键已用于不同的接力动作。"}
	case errors.Is(err, relaydomain.ErrInvalidStagePlan):
		return &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "接力动作参数无效。"}
	default:
		return internalError(err)
	}
}

func optionalString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// RoomsListRelayStageHistory exposes the history contract while the relay
// projector and pagination implementation remain owned by MRX-011.
func (s *Server) RoomsListRelayStageHistory(_ context.Context, _ openapi.RoomsListRelayStageHistoryRequestObject) (openapi.RoomsListRelayStageHistoryResponseObject, error) {
	return openapi.RoomsListRelayStageHistory501JSONResponse{
		Code:  codeFeatureDisabled,
		Error: "relay stage history is not enabled",
	}, nil
}
