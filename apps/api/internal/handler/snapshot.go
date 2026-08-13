// 房间快照（08 §7.3 逐观察者投影）：match/round 视图 + 事件重放投影。
// 数据源 = GetRoomSnapshotState（jsonb_agg 单查询）；展示水合与列置换在 Go 投影层完成。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// snapshotState GetRoomSnapshotState 的解析形态（键为 jsonb_build_object 的键名）。
// 注意：to_jsonb 把 multi_guess.statuses（jsonb 数组）渲染为 JSON 数组，不能直接
// unmarshal 进 repo.MultiGuess.Statuses（[]byte）——用快照专用形态承接。
type snapshotState struct {
	Room           repo.MultiRoom     `json:"room"`
	Members        []repo.MultiMember `json:"members"`
	SpectatorCount int32              `json:"spectatorCount"`
	Match          *repo.MultiMatch   `json:"match"`
	Round          *repo.MultiRound   `json:"round"`
	Guesses        []snapshotGuess    `json:"guesses"`
	Turns          []snapshotTurn     `json:"turns"`
}

type snapshotRoom struct {
	ID            string             `json:"id"`
	Code          string             `json:"code"`
	Format        string             `json:"format"`
	Status        string             `json:"status"`
	EventSeq      int64              `json:"event_seq"`
	CreatedAt     pgtype.Timestamptz `json:"created_at"`
	ExpiresAt     pgtype.Timestamptz `json:"expires_at"`
	Mode          string             `json:"mode"`
	TurnSeconds   int32              `json:"turn_seconds"`
	QuestionScope json.RawMessage    `json:"question_scope"`
	PlayerLimit   int32              `json:"player_limit"`
}

type snapshotMatch struct {
	ID             string             `json:"id"`
	RoomID         string             `json:"room_id"`
	MatchIndex     int32              `json:"match_index"`
	CatalogVersion string             `json:"catalog_version"`
	TargetWins     int32              `json:"target_wins"`
	ScoreSlot1     int32              `json:"score_slot1"`
	ScoreSlot2     int32              `json:"score_slot2"`
	RoundCount     int32              `json:"round_count"`
	Status         string             `json:"status"`
	StartedAt      pgtype.Timestamptz `json:"started_at"`
	EndedAt        pgtype.Timestamptz `json:"ended_at"`
	QuestionScope  json.RawMessage    `json:"question_scope"`
}

func (room snapshotRoom) toRepo() repo.MultiRoom {
	return repo.MultiRoom{
		ID:            room.ID,
		Code:          room.Code,
		Format:        room.Format,
		Status:        room.Status,
		EventSeq:      room.EventSeq,
		CreatedAt:     room.CreatedAt,
		ExpiresAt:     room.ExpiresAt,
		Mode:          room.Mode,
		TurnSeconds:   room.TurnSeconds,
		QuestionScope: append([]byte{}, room.QuestionScope...),
		PlayerLimit:   room.PlayerLimit,
	}
}

func (match snapshotMatch) toRepo() repo.MultiMatch {
	return repo.MultiMatch{
		ID:             match.ID,
		RoomID:         match.RoomID,
		MatchIndex:     match.MatchIndex,
		CatalogVersion: match.CatalogVersion,
		TargetWins:     match.TargetWins,
		ScoreSlot1:     match.ScoreSlot1,
		ScoreSlot2:     match.ScoreSlot2,
		RoundCount:     match.RoundCount,
		Status:         match.Status,
		StartedAt:      match.StartedAt,
		EndedAt:        match.EndedAt,
		QuestionScope:  append([]byte{}, match.QuestionScope...),
	}
}

func (state *snapshotState) UnmarshalJSON(data []byte) error {
	var raw struct {
		Room           snapshotRoom       `json:"room"`
		Members        []repo.MultiMember `json:"members"`
		SpectatorCount int32              `json:"spectatorCount"`
		Match          *snapshotMatch     `json:"match"`
		Round          *repo.MultiRound   `json:"round"`
		Guesses        []snapshotGuess    `json:"guesses"`
		Turns          []snapshotTurn     `json:"turns"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	state.Room = raw.Room.toRepo()
	state.Members = raw.Members
	state.SpectatorCount = raw.SpectatorCount
	if raw.Match != nil {
		match := raw.Match.toRepo()
		state.Match = &match
	} else {
		state.Match = nil
	}
	state.Round = raw.Round
	state.Guesses = raw.Guesses
	state.Turns = raw.Turns
	return nil
}

// snapshotGuess 快照猜测行（statuses 为数组形态）。
type snapshotGuess struct {
	ID        string   `json:"id"`
	RoundID   string   `json:"round_id"`
	MemberID  string   `json:"member_id"`
	Sequence  int32    `json:"sequence"`
	GuessID   string   `json:"guess_id"`
	Statuses  []string `json:"statuses"`
	IsCorrect bool     `json:"is_correct"`
}

type snapshotTurn struct {
	ID        string    `json:"id"`
	RoundID   string    `json:"round_id"`
	MemberID  string    `json:"member_id"`
	TurnIndex int32     `json:"turn_index"`
	Kind      string    `json:"kind"`
	GuessID   *string   `json:"guess_id"`
	Statuses  *[]string `json:"statuses"`
	IsCorrect bool      `json:"is_correct"`
}

// RoomsGetSnapshot 房间快照与事件重放（成员令牌；中间件已鉴权）。
func (s *Server) RoomsGetSnapshot(ctx context.Context, request openapi.RoomsGetSnapshotRequestObject) (openapi.RoomsGetSnapshotResponseObject, error) {
	member, ok := GuestMemberFromContext(ctx)
	if !ok {
		return nil, guestUnauthorized("缺少鉴权上下文。")
	}
	after := int64(0)
	if request.Params.After != nil {
		after = int64(*request.Params.After)
	}
	raw, err := s.q.GetRoomSnapshotState(ctx, request.RoomId)
	if err != nil {
		return nil, internalError(err)
	}
	var state snapshotState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, internalError(err)
	}
	if state.Room.ID == "" {
		return nil, roomNotFound()
	}
	events, err := s.q.ListEventsAfterSeq(ctx, repo.ListEventsAfterSeqParams{
		RoomID: request.RoomId, Sequence: after,
	})
	if err != nil {
		return nil, internalError(err)
	}
	return s.buildSnapshot(ctx, state, *member, events)
}

// buildSnapshot 组装逐观察者快照：room/members/match/round（水合）+ events（投影）。
func (s *Server) buildSnapshot(ctx context.Context, state snapshotState, observer repo.MultiMember, events []repo.RoomEvent) (openapi.RoomsGetSnapshotResponseObject, error) {
	memberViews := make([]openapi.MemberView, 0, len(state.Members))
	for _, view := range multi.MemberViews(state.Members) {
		memberViews = append(memberViews, toOpenAPIMemberView(view))
	}
	snapshot := openapi.RoomSnapshot{
		RoomId:         state.Room.ID,
		RoomCode:       state.Room.Code,
		Format:         openapi.RoomFormat(state.Room.Format),
		Mode:           openapi.MultiplayerMode(state.Room.Mode),
		TurnSeconds:    openapi.RoomSnapshotTurnSeconds(state.Room.TurnSeconds),
		Status:         openapi.RoomStatus(state.Room.Status),
		ExpiresAt:      state.Room.ExpiresAt.Time,
		Viewer:         toOpenAPIParticipantView(multi.ParticipantViewFor(observer)),
		Members:        memberViews,
		SpectatorCount: int(state.SpectatorCount),
	}
	roomScope, err := storedQuestionScopeFromJSON(state.Room.QuestionScope)
	if err != nil {
		return nil, internalError(err)
	}
	openapiRoomScope := toOpenAPIQuestionScope(roomScope)
	snapshot.QuestionScope = &openapiRoomScope

	if state.Match != nil {
		format := multi.RoomFormat(state.Room.Format)
		roundIndex := 0
		if state.Round != nil {
			roundIndex = int(state.Round.RoundIndex)
		}
		rematchReady := [2]bool{}
		for _, m := range state.Members {
			if multi.MemberSeat(m) == 1 {
				rematchReady[0] = m.RematchReady
			} else {
				rematchReady[1] = m.RematchReady
			}
		}
		matchScope, err := storedQuestionScopeFromJSON(state.Match.QuestionScope)
		if err != nil {
			return nil, internalError(err)
		}
		if matchScope.SchemaVersion == 0 {
			matchScope = roomScope
		}
		openapiMatchScope := toOpenAPIQuestionScope(matchScope)
		matchView := openapi.MatchView{
			MatchIndex:     int(state.Match.MatchIndex),
			TargetWins:     int(state.Match.TargetWins),
			ScoreSlot1:     int(state.Match.ScoreSlot1),
			ScoreSlot2:     int(state.Match.ScoreSlot2),
			RoundIndex:     roundIndex,
			MaxRounds:      multi.MaxRounds(format, s.timing.MaxRoundsFactor),
			RematchReady:   rematchReady[:],
			CatalogVersion: state.Match.CatalogVersion,
			QuestionScope:  &openapiMatchScope,
		}
		snapshot.Match = &matchView

		if state.Round != nil {
			roundView, err := s.buildRoundView(ctx, state, observer)
			if err != nil {
				return nil, err
			}
			snapshot.Round = roundView
		}
	}

	projected, err := s.projectEvents(ctx, events, state, observer)
	if err != nil {
		return nil, err
	}
	snapshot.Events = projected
	return openapi.RoomsGetSnapshot200JSONResponse(snapshot), nil
}

// buildRoundView 当前局视图：self（完整棋盘）+ opponent（匿名矩阵，列置换）。
func (s *Server) buildRoundView(ctx context.Context, state snapshotState, observer repo.MultiMember) (*openapi.RoundView, error) {
	characters, err := multi.CharactersForVersion(ctx, s.q, state.Match.CatalogVersion)
	if err != nil {
		return nil, internalError(err)
	}
	byID := multi.CharactersByID(characters)
	fields := multi.FieldsForMatch(*state.Match)
	perm := multi.ColumnPermutation(state.Round.ID, observer.ID, len(fields))

	self := []openapi.GuessResult{}
	opponentRows := []openapi.OpponentRow{} // 空对手矩阵序列化为 []（前端按数组消费）
	spectatorBoards := struct {
		Slot1 []openapi.GuessResult `json:"slot1"`
		Slot2 []openapi.GuessResult `json:"slot2"`
	}{Slot1: []openapi.GuessResult{}, Slot2: []openapi.GuessResult{}}
	for _, guess := range state.Guesses {
		statuses := guess.Statuses
		guessChar, ok := byID[guess.GuessID]
		if !ok {
			return nil, internalError(errors.New("guess character missing from snapshot"))
		}
		if multi.IsSpectator(observer) {
			hydrated := toOpenAPIGuessResult(multi.HydrateGuessResultWithFields(guessChar, statuses, guess.IsCorrect, fields))
			if memberSlotForID(state.Members, guess.MemberID) == 1 {
				spectatorBoards.Slot1 = append(spectatorBoards.Slot1, hydrated)
			} else {
				spectatorBoards.Slot2 = append(spectatorBoards.Slot2, hydrated)
			}
			continue
		}
		if guess.MemberID == observer.ID {
			hydrated := multi.HydrateGuessResultWithFields(guessChar, statuses, guess.IsCorrect, fields)
			self = append(self, toOpenAPIGuessResult(hydrated))
		} else {
			visibleStatuses := multi.StatusesForFields(statuses, fields)
			opponentRows = append(opponentRows, openapi.OpponentRow{
				Index:    int(guess.Sequence),
				Statuses: toOpenAPIFeedbackStatuses(multi.PermuteStatuses(visibleStatuses, perm)),
			})
		}
	}
	roundView := openapi.RoundView{
		Status:     openapi.RoundStatus(state.Round.Status),
		StartsAt:   state.Round.StartsAt.Time,
		Deadline:   state.Round.Deadline.Time,
		MaxGuesses: multi.MaxGuessesForMatch(*state.Match),
	}
	roundView.Self.Guesses = self
	roundView.Opponent.Rows = opponentRows
	if multi.IsSpectator(observer) {
		roundView.Boards = &spectatorBoards
	}
	if multi.MultiplayerMode(state.Room.Mode) == multi.MultiplayerModeRelay {
		rows := make([]openapi.RelayTurnRow, 0, len(state.Turns))
		for _, turn := range state.Turns {
			row := openapi.RelayTurnRow{
				Index:      int(turn.TurnIndex),
				Kind:       openapi.RelayTurnRowKind(turn.Kind),
				MemberSlot: memberSlotForID(state.Members, turn.MemberID),
			}
			if turn.Kind == string(multi.RelayTurnKindGuess) && turn.GuessID != nil && turn.Statuses != nil {
				guessChar, ok := byID[*turn.GuessID]
				if !ok {
					return nil, internalError(errors.New("relay turn character missing from snapshot"))
				}
				hydrated := multi.HydrateGuessResultWithFields(guessChar, *turn.Statuses, turn.IsCorrect, fields)
				guess := toOpenAPIGuessResult(hydrated)
				row.Guess = &guess
			}
			rows = append(rows, row)
		}
		roundView.Shared = &struct {
			Rows []openapi.RelayTurnRow `json:"rows"`
		}{Rows: rows}
		if state.Round.TurnSlot.Valid {
			slot := int(state.Round.TurnSlot.Int32)
			roundView.TurnSlot = &slot
		}
		if state.Round.TurnDeadline.Valid {
			deadline := state.Round.TurnDeadline.Time
			roundView.TurnDeadline = &deadline
		}
		maxTurns := multi.MaxGuessesForMatch(*state.Match)
		roundView.MaxTurnsPerPlayer = &maxTurns
	}
	return &roundView, nil
}

func memberSlotForID(members []repo.MultiMember, memberID string) int {
	for _, member := range members {
		if member.ID == memberID {
			return multi.MemberSeat(member)
		}
	}
	return 0
}

// projectEvents 事件重放投影（08 §4.5 三路径共用投影语义）：
// round.opponent.guess 仅推对手（剥离 memberSlot/roundID、按观察者列置换）；
// round.ended/match.ended 的 result 按观察者推导（round.ended 另水合答案与双方完整棋盘）。
func (s *Server) projectEvents(ctx context.Context, events []repo.RoomEvent, state snapshotState, observer repo.MultiMember) ([]openapi.RoomEventEnvelope, error) {
	out := make([]openapi.RoomEventEnvelope, 0, len(events))
	charCache := map[string]map[string]game.Character{}
	memberSlotByID := map[string]int32{}
	for _, m := range state.Members {
		memberSlotByID[m.ID] = int32(multi.MemberSeat(m))
	}

	for _, event := range events {
		projected, skip, err := multi.ProjectEvent(ctx, s.q, event, state.Room.ID, observer, memberSlotByID, charCache)
		if err != nil {
			return nil, internalError(err)
		}
		if skip {
			continue
		}
		raw, err := json.Marshal(projected.Payload)
		if err != nil {
			return nil, internalError(err)
		}
		wire := map[string]any{}
		if err := json.Unmarshal(raw, &wire); err != nil {
			return nil, internalError(err)
		}
		out = append(out, openapi.RoomEventEnvelope{
			Type: string(projected.Type), EventId: eventID(event), RoomId: event.RoomID,
			Sequence: int(event.Sequence), OccurredAt: event.OccurredAt.Time, Payload: wire,
		})
	}
	return out, nil
}

// hydrateBoards 局末双方完整棋盘（按成员 slot 分组、时间序）。
func hydrateBoards(guesses []repo.MultiGuess, chars map[string]game.Character, memberSlotByID map[string]int32) map[string][]openapi.GuessResult {
	boards := map[string][]openapi.GuessResult{"slot1": {}, "slot2": {}}
	for _, guess := range guesses {
		var statuses []string
		if err := json.Unmarshal(guess.Statuses, &statuses); err != nil {
			continue
		}
		guessChar, ok := chars[guess.GuessID]
		if !ok {
			continue
		}
		slot := memberSlotByID[guess.MemberID]
		key := "slot2"
		if slot == 1 {
			key = "slot1"
		}
		boards[key] = append(boards[key], toOpenAPIGuessResult(multi.HydrateGuessResult(guessChar, statuses, guess.IsCorrect)))
	}
	return boards
}

// resultForObserver 由 winnerSlot 推导观察者视角结果（win/loss/draw）。
func resultForObserver(winnerSlot *int, observerSlot int) string {
	if winnerSlot == nil {
		return "draw"
	}
	if *winnerSlot == observerSlot {
		return "win"
	}
	return "loss"
}

func toOpenAPIFeedbackStatuses(statuses []string) []openapi.FeedbackStatus {
	out := make([]openapi.FeedbackStatus, len(statuses))
	for i, s := range statuses {
		out[i] = openapi.FeedbackStatus(s)
	}
	return out
}

func eventID(event repo.RoomEvent) string {
	return fmt.Sprintf("%d", event.ID)
}
