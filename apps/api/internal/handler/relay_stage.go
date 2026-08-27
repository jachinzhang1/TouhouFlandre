package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	relaydomain "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
	relayadapter "github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay/adapter"
)

const (
	relayHistoryDefaultLimit = 10
	relayHistoryMaxLimit     = 20
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
	if s.relayEncounters == nil {
		return nil, internalError(errors.New("relay command runtime is not registered"))
	}
	result, err := s.relayEncounters.Act(ctx, relayadapter.EncounterActionInput{
		RoomID: request.RoomId, StageIndex: request.StageIndex, EncounterID: request.EncounterId,
		ActorMemberID: member.ID, Action: relayadapter.EncounterAction(request.Body.Action),
		GuessID: optionalString(request.Body.GuessId), IdempotencyKey: request.Body.IdempotencyKey,
	})
	if result.Changed {
		s.publish(request.RoomId)
	}
	if result.ChatChanged {
		s.publishChatRoom(request.RoomId)
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

func (s *Server) RoomsListRelayStageHistory(ctx context.Context, request openapi.RoomsListRelayStageHistoryRequestObject) (openapi.RoomsListRelayStageHistoryResponseObject, error) {
	started := time.Now()
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	room, err := s.q.GetRoom(ctx, request.RoomId)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, roomNotFound()
	}
	if err != nil {
		return nil, internalError(err)
	}
	match, err := s.q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: request.RoomId, MatchIndex: int32(request.MatchIndex)})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, roomNotFound()
	}
	if err != nil {
		return nil, internalError(err)
	}
	ref, apiErr := s.ruleSetForState(room, match)
	if apiErr != nil {
		return nil, apiErr
	}
	if ref.Mode != core.ModeRelay {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "只有接力场次支持 stage 历史。"}
	}
	labels := multi.NewMetricLabels(string(ref.Mode), ref.Key, ref.Version)
	defer func() { multi.DefaultMetrics.RecordHistoryLatency(labels, time.Since(started)) }()
	reader, err := s.modeRegistry.HistoryReader(ref.Mode)
	if err != nil {
		return nil, internalError(err)
	}
	if _, err := reader.Style(ref); err != nil {
		return nil, internalError(err)
	}

	limit := relayHistoryDefaultLimit
	if request.Params.Limit != nil {
		limit = *request.Params.Limit
	}
	if limit < 1 || limit > relayHistoryMaxLimit {
		return nil, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "limit 超出允许范围。"}
	}
	afterStageIndex, cursorErr := decodeRelayStageHistoryCursor(request.Params.After, request.MatchIndex)
	if cursorErr != nil {
		return nil, cursorErr
	}
	stages, err := s.q.ListEndedRelayStagesPage(ctx, repo.ListEndedRelayStagesPageParams{
		MatchID: match.ID, AfterStageIndex: int32(afterStageIndex), LimitCount: int32(limit + 1),
	})
	if err != nil {
		return nil, internalError(err)
	}
	var nextCursor *string
	if len(stages) > limit {
		stages = stages[:limit]
		cursor, err := encodeRelayStageHistoryCursor(request.MatchIndex, int(stages[len(stages)-1].StageIndex))
		if err != nil {
			return nil, internalError(err)
		}
		nextCursor = &cursor
	}
	roster, err := s.q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return nil, internalError(err)
	}
	rosterStatusByMember := make(map[string]string, len(roster))
	for _, player := range roster {
		rosterStatusByMember[player.MemberID] = player.Status
	}
	stageViews, err := s.buildRelayStageViews(ctx, match, stages, *member, rosterStatusByMember, relayStageViewOptions{IncludeDetails: true})
	if err != nil {
		return nil, internalError(err)
	}
	history := make([]openapi.RelayStageHistoryView, 0, len(stageViews))
	for _, stageView := range stageViews {
		view, err := relayStageHistoryView(stageView)
		if err != nil {
			return nil, internalError(err)
		}
		history = append(history, view)
	}
	return openapi.RoomsListRelayStageHistory200JSONResponse{
		Stages: history, NextCursor: nextCursor,
	}, nil
}

type relayStageHistoryCursor struct {
	Version         int `json:"v"`
	MatchIndex      int `json:"matchIndex"`
	AfterStageIndex int `json:"afterStageIndex"`
}

func encodeRelayStageHistoryCursor(matchIndex, afterStageIndex int) (string, error) {
	payload, err := json.Marshal(relayStageHistoryCursor{Version: 1, MatchIndex: matchIndex, AfterStageIndex: afterStageIndex})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeRelayStageHistoryCursor(value *string, matchIndex int) (int, *ApiError) {
	if value == nil || *value == "" {
		return 0, nil
	}
	payload, err := base64.RawURLEncoding.DecodeString(*value)
	if err != nil {
		return 0, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "history cursor 无效。"}
	}
	var cursor relayStageHistoryCursor
	if err := json.Unmarshal(payload, &cursor); err != nil {
		return 0, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "history cursor 无效。"}
	}
	if cursor.Version != 1 || cursor.MatchIndex != matchIndex || cursor.AfterStageIndex < 0 {
		return 0, &ApiError{Status: http.StatusBadRequest, Code: codeInvalidRequest, Message: "history cursor 无效。"}
	}
	return cursor.AfterStageIndex, nil
}

func relayStageHistoryView(stage openapi.RelayStageView) (openapi.RelayStageHistoryView, error) {
	if stage.Status != openapi.RelayStageViewStatusEnded || stage.EncounterDetails == nil {
		return openapi.RelayStageHistoryView{}, errors.New("relay history stage is not terminal")
	}
	encounters := make([]openapi.RelayEncounterHistoryView, 0, len(*stage.EncounterDetails))
	for _, detail := range *stage.EncounterDetails {
		encounter, err := relayEncounterHistoryView(detail)
		if err != nil {
			return openapi.RelayStageHistoryView{}, err
		}
		encounters = append(encounters, encounter)
	}
	settlement := []openapi.RelayStageSettlementView{}
	if stage.Settlement != nil {
		settlement = *stage.Settlement
	}
	return openapi.RelayStageHistoryView{
		StageId: stage.StageId, StageIndex: stage.StageIndex, Status: openapi.RelayStageHistoryViewStatusEnded,
		Encounters: encounters, ByeMemberId: stage.ByeMemberId, Settlement: settlement,
	}, nil
}

func relayEncounterHistoryView(detail openapi.RelayEncounterView) (openapi.RelayEncounterHistoryView, error) {
	if detail.Status != openapi.RelayEncounterViewStatusEnded || detail.Answer == nil || detail.Outcome == nil {
		return openapi.RelayEncounterHistoryView{}, errors.New("relay history encounter is not terminal")
	}
	return openapi.RelayEncounterHistoryView{
		Answer: *detail.Answer, Capabilities: detail.Capabilities, Deadline: detail.Deadline,
		EncounterId: detail.EncounterId, EncounterIndex: detail.EncounterIndex,
		MaxSkipsPerPlayer: detail.MaxSkipsPerPlayer, MaxTurnsPerPlayer: detail.MaxTurnsPerPlayer,
		Members: detail.Members, Outcome: openapi.RelayEncounterHistoryViewOutcome(*detail.Outcome), Rows: detail.Rows,
		StartsAt: detail.StartsAt, Status: openapi.RelayEncounterHistoryViewStatusEnded,
		TurnDeadline: detail.TurnDeadline, TurnMemberId: detail.TurnMemberId, TurnSeat: detail.TurnSeat,
		WinnerMemberId: detail.WinnerMemberId,
	}, nil
}
