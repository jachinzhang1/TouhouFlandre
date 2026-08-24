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
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

// snapshotState GetRoomSnapshotState 的解析形态（键为 jsonb_build_object 的键名）。
// 注意：to_jsonb 把 multi_guess.statuses（jsonb 数组）渲染为 JSON 数组，不能直接
// unmarshal 进 repo.MultiGuess.Statuses（[]byte）——用快照专用形态承接。
type snapshotState struct {
	Room           repo.MultiRoom          `json:"room"`
	Members        []repo.MultiMember      `json:"members"`
	SpectatorCount int32                   `json:"spectatorCount"`
	Match          *repo.MultiMatch        `json:"match"`
	Round          *repo.MultiRound        `json:"round"`
	Guesses        []snapshotGuess         `json:"guesses"`
	RoundPlayers   []repo.MultiRoundPlayer `json:"roundPlayers"`
	Turns          []snapshotTurn          `json:"turns"`
}

type snapshotRoom struct {
	ID                     string             `json:"id"`
	Code                   string             `json:"code"`
	Format                 string             `json:"format"`
	Status                 string             `json:"status"`
	EventSeq               int64              `json:"event_seq"`
	CreatedAt              pgtype.Timestamptz `json:"created_at"`
	ExpiresAt              pgtype.Timestamptz `json:"expires_at"`
	Mode                   string             `json:"mode"`
	TurnSeconds            int32              `json:"turn_seconds"`
	QuestionScope          json.RawMessage    `json:"question_scope"`
	PlayerLimit            int32              `json:"player_limit"`
	RaceEliminationEnabled bool               `json:"race_elimination_enabled"`
}

type snapshotMatch struct {
	ID                 string             `json:"id"`
	RoomID             string             `json:"room_id"`
	MatchIndex         int32              `json:"match_index"`
	CatalogVersion     string             `json:"catalog_version"`
	TargetWins         int32              `json:"target_wins"`
	ScoreSlot1         int32              `json:"score_slot1"`
	ScoreSlot2         int32              `json:"score_slot2"`
	RoundCount         int32              `json:"round_count"`
	Status             string             `json:"status"`
	StartedAt          pgtype.Timestamptz `json:"started_at"`
	EndedAt            pgtype.Timestamptz `json:"ended_at"`
	QuestionScope      json.RawMessage    `json:"question_scope"`
	ScoringMode        string             `json:"scoring_mode"`
	RosterSize         int32              `json:"roster_size"`
	MaxRounds          int32              `json:"max_rounds"`
	RuleSetKey         string             `json:"rule_set_key"`
	RuleSetVersion     int32              `json:"rule_set_version"`
	RuleConfigSnapshot json.RawMessage    `json:"rule_config_snapshot"`
}

func (room snapshotRoom) toRepo() repo.MultiRoom {
	return repo.MultiRoom{
		ID:                     room.ID,
		Code:                   room.Code,
		Format:                 room.Format,
		Status:                 room.Status,
		EventSeq:               room.EventSeq,
		CreatedAt:              room.CreatedAt,
		ExpiresAt:              room.ExpiresAt,
		Mode:                   room.Mode,
		TurnSeconds:            room.TurnSeconds,
		QuestionScope:          append([]byte{}, room.QuestionScope...),
		PlayerLimit:            room.PlayerLimit,
		RaceEliminationEnabled: room.RaceEliminationEnabled,
	}
}

func (match snapshotMatch) toRepo() repo.MultiMatch {
	return repo.MultiMatch{
		ID:                 match.ID,
		RoomID:             match.RoomID,
		MatchIndex:         match.MatchIndex,
		CatalogVersion:     match.CatalogVersion,
		TargetWins:         match.TargetWins,
		ScoreSlot1:         match.ScoreSlot1,
		ScoreSlot2:         match.ScoreSlot2,
		RoundCount:         match.RoundCount,
		Status:             match.Status,
		StartedAt:          match.StartedAt,
		EndedAt:            match.EndedAt,
		QuestionScope:      append([]byte{}, match.QuestionScope...),
		ScoringMode:        match.ScoringMode,
		RosterSize:         match.RosterSize,
		MaxRounds:          match.MaxRounds,
		RuleSetKey:         match.RuleSetKey,
		RuleSetVersion:     match.RuleSetVersion,
		RuleConfigSnapshot: append([]byte{}, match.RuleConfigSnapshot...),
	}
}

func (state *snapshotState) UnmarshalJSON(data []byte) error {
	var raw struct {
		Room           snapshotRoom            `json:"room"`
		Members        []repo.MultiMember      `json:"members"`
		SpectatorCount int32                   `json:"spectatorCount"`
		Match          *snapshotMatch          `json:"match"`
		Round          *repo.MultiRound        `json:"round"`
		Guesses        []snapshotGuess         `json:"guesses"`
		RoundPlayers   []repo.MultiRoundPlayer `json:"roundPlayers"`
		Turns          []snapshotTurn          `json:"turns"`
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
	state.RoundPlayers = raw.RoundPlayers
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
	if _, err := s.roomPolicyForState(state.Room); err != nil {
		return nil, err
	}
	memberViews := make([]openapi.MemberView, 0, len(state.Members))
	for _, view := range multi.MemberViews(state.Members) {
		memberViews = append(memberViews, toOpenAPIMemberView(view))
	}
	capacity := multi.RoomCapacity(len(memberViews), int(state.Room.PlayerLimit))
	snapshot := openapi.RoomSnapshot{
		RoomId:                 state.Room.ID,
		RoomCode:               state.Room.Code,
		Format:                 openapi.RoomFormat(state.Room.Format),
		Mode:                   openapi.MultiplayerMode(state.Room.Mode),
		TurnSeconds:            openapi.RoomSnapshotTurnSeconds(state.Room.TurnSeconds),
		Status:                 openapi.RoomStatus(state.Room.Status),
		ExpiresAt:              state.Room.ExpiresAt.Time,
		Viewer:                 toOpenAPIParticipantView(multi.ParticipantViewFor(observer)),
		Members:                memberViews,
		PlayerCount:            capacity.PlayerCount,
		SpectatorCount:         int(state.SpectatorCount),
		PlayerLimit:            capacity.PlayerLimit,
		RaceEliminationEnabled: state.Room.RaceEliminationEnabled,
		MinPlayers:             openapi.RoomSnapshotMinPlayers(capacity.MinPlayers),
		AvailableSeats:         capacity.AvailableSeats,
		GameSequence:           int(state.Room.EventSeq),
	}
	roomScope, err := storedQuestionScopeFromJSON(state.Room.QuestionScope)
	if err != nil {
		return nil, internalError(err)
	}
	openapiRoomScope := toOpenAPIQuestionScope(roomScope)
	snapshot.QuestionScope = &openapiRoomScope

	if state.Match != nil {
		ref, err := s.ruleSetForState(state.Room, *state.Match)
		if err != nil {
			return nil, err
		}
		projector, err := s.modeRegistry.SnapshotProjector(ref.Mode)
		if err != nil {
			return nil, internalError(err)
		}
		projectionStyle, err := projector.Style(ref)
		if err != nil {
			return nil, internalError(err)
		}
		roundIndex := 0
		var relayFragment *openapi.RelayMatchFragment
		var relayRound *openapi.RoundView
		if state.Round != nil {
			roundIndex = int(state.Round.RoundIndex)
		} else if ref.Mode == core.ModeRelay {
			var err error
			relayFragment, relayRound, roundIndex, err = s.buildRelaySnapshot(ctx, *state.Match, state.Members, observer, ref)
			if err != nil {
				return nil, internalError(err)
			}
		}
		roster, err := s.q.ListMatchPlayers(ctx, state.Match.ID)
		if err != nil {
			return nil, internalError(err)
		}
		scoreByMemberID := make(map[string]int, len(roster))
		for _, player := range roster {
			scoreByMemberID[player.MemberID] = int(player.Score)
		}
		scores := make([]openapi.MemberScoreView, 0, len(state.Members))
		rematchReady := make([]openapi.MemberRematchReadyView, 0, len(state.Members))
		for _, m := range state.Members {
			seat := multi.MemberSeat(m)
			var player repo.MultiMatchPlayer
			for _, candidate := range roster {
				if candidate.MemberID == m.ID {
					player = candidate
					break
				}
			}
			var eliminatedRound *int
			if player.EliminatedRound.Valid {
				value := int(player.EliminatedRound.Int32)
				eliminatedRound = &value
			}
			scores = append(scores, openapi.MemberScoreView{MemberId: m.ID, Seat: seat, Score: scoreByMemberID[m.ID], Status: openapi.MatchPlayerStatus(player.Status), BestRoundScore: int(player.BestRoundScore), EliminatedRound: eliminatedRound})
			rematchReady = append(rematchReady, openapi.MemberRematchReadyView{MemberId: m.ID, Seat: seat, Ready: m.RematchReady})
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
			Scores:         scores,
			RoundIndex:     roundIndex,
			MaxRounds:      int(state.Match.MaxRounds),
			ScoringMode:    openapi.ScoringMode(state.Match.ScoringMode),
			RosterSize:     int(state.Match.RosterSize),
			RematchReady:   rematchReady,
			CatalogVersion: state.Match.CatalogVersion,
			QuestionScope:  &openapiMatchScope,
			RuleSetRef: openapi.RuleSetRef{
				Mode: openapi.MultiplayerMode(ref.Mode), Key: ref.Key, Version: ref.Version,
			},
		}
		matchView.Relay = relayFragment
		snapshot.Match = &matchView

		if state.Round != nil {
			roundView, err := s.buildRoundView(ctx, state, observer, projectionStyle)
			if err != nil {
				return nil, err
			}
			snapshot.Round = roundView
		} else if relayRound != nil {
			snapshot.Round = relayRound
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
func (s *Server) buildRoundView(ctx context.Context, state snapshotState, observer repo.MultiMember, projectionStyle core.ProjectionStyle) (*openapi.RoundView, error) {
	characters, err := multi.CharactersForVersion(ctx, s.q, state.Match.CatalogVersion)
	if err != nil {
		return nil, internalError(err)
	}
	byID := multi.CharactersByID(characters)
	fields := multi.FieldsForMatch(*state.Match)
	matchPlayers, err := s.q.ListMatchPlayers(ctx, state.Match.ID)
	if err != nil {
		return nil, internalError(err)
	}
	observerEliminated := false
	for _, player := range matchPlayers {
		if player.MemberID == observer.ID && player.Status != "active" {
			observerEliminated = true
			break
		}
	}
	readOnlyObserver := multi.IsSpectator(observer) || observerEliminated
	participationByMemberID := make(map[string]repo.MultiRoundPlayer, len(state.RoundPlayers))
	for _, player := range state.RoundPlayers {
		participationByMemberID[player.MemberID] = player
	}
	permutationByMemberID := make(map[string][]int, len(state.Members))

	self := []openapi.GuessResult{}
	opponents := make([]openapi.OpponentBoardView, 0, len(state.Members))
	opponentIndexByMemberID := make(map[string]int, len(state.Members))
	spectatorBoards := make([]openapi.MemberBoardView, 0, len(state.Members))
	boardIndexByMemberID := make(map[string]int, len(state.Members))
	for _, member := range state.Members {
		seat := multi.MemberSeat(member)
		boardIndexByMemberID[member.ID] = len(spectatorBoards)
		spectatorBoards = append(spectatorBoards, openapi.MemberBoardView{
			MemberId: member.ID,
			Seat:     seat,
			Guesses:  []openapi.GuessResult{},
		})
		if !readOnlyObserver && multi.IsPlayer(observer) && member.ID != observer.ID {
			perm := multi.ColumnPermutation(s.projectionSecret, state.Round.ID, observer.ID, member.ID, multi.ProjectionSchemaVersion, len(fields))
			permutationByMemberID[member.ID] = perm
			opponentIndexByMemberID[member.ID] = len(opponents)
			opponents = append(opponents, openapi.OpponentBoardView{
				MemberId:   member.ID,
				Seat:       seat,
				FieldOrder: toOpenAPIGuessFieldKeys(multi.PermuteFieldOrder(fields, perm)),
				Rows:       []openapi.OpponentRow{},
			})
		}
	}
	for _, guess := range state.Guesses {
		statuses := guess.Statuses
		guessChar, ok := byID[guess.GuessID]
		if !ok {
			return nil, internalError(errors.New("guess character missing from snapshot"))
		}
		if readOnlyObserver {
			hydrated := toOpenAPIGuessResult(multi.HydrateGuessResultWithFields(guessChar, statuses, guess.IsCorrect, fields))
			if index, ok := boardIndexByMemberID[guess.MemberID]; ok {
				spectatorBoards[index].Guesses = append(spectatorBoards[index].Guesses, hydrated)
			}
			continue
		}
		if guess.MemberID == observer.ID {
			hydrated := multi.HydrateGuessResultWithFields(guessChar, statuses, guess.IsCorrect, fields)
			self = append(self, toOpenAPIGuessResult(hydrated))
		} else {
			visibleStatuses := multi.StatusesForFields(statuses, fields)
			perm := permutationByMemberID[guess.MemberID]
			index, ok := opponentIndexByMemberID[guess.MemberID]
			if !ok {
				continue
			}
			opponents[index].Rows = append(opponents[index].Rows, openapi.OpponentRow{
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
		Opponents:  opponents,
	}
	roundView.Self.Guesses = self
	if !readOnlyObserver && multi.IsPlayer(observer) {
		memberID := observer.ID
		seat := multi.MemberSeat(observer)
		roundView.Self.MemberId = &memberID
		roundView.Self.Seat = &seat
	}
	if readOnlyObserver {
		roundView.Boards = &spectatorBoards
	}
	if participant, ok := participationByMemberID[observer.ID]; ok {
		status := openapi.RaceRoundParticipantStatus(participant.Status)
		roundView.Self.ParticipationStatus = &status
		if participant.FinishRank.Valid {
			rank := int(participant.FinishRank.Int32)
			roundView.Self.FinishRank = &rank
		}
	}
	if projectionStyle == core.ProjectionRelayShared {
		rows := make([]openapi.RelayTurnRow, 0, len(state.Turns))
		for _, turn := range state.Turns {
			row := openapi.RelayTurnRow{
				Index:    int(turn.TurnIndex),
				Kind:     openapi.RelayTurnRowKind(turn.Kind),
				MemberId: turn.MemberID,
				Seat:     memberSlotForID(state.Members, turn.MemberID),
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
			seat := int(state.Round.TurnSlot.Int32)
			roundView.TurnSeat = &seat
			for _, member := range state.Members {
				if multi.MemberSeat(member) == seat {
					memberID := member.ID
					roundView.TurnMemberId = &memberID
					break
				}
			}
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
// round.opponent.guess 仅推对手（内部 slot 适配为 memberId + seat、按观察者列置换）；
// round.ended/match.ended 按观察者补 viewerResult，并生成按 seat 排序的公开集合。
func (s *Server) projectEvents(ctx context.Context, events []repo.RoomEvent, state snapshotState, observer repo.MultiMember) ([]openapi.RoomEventEnvelope, error) {
	if state.Match != nil {
		ref, err := s.ruleSetForState(state.Room, *state.Match)
		if err != nil {
			return nil, err
		}
		reader, err := s.modeRegistry.HistoryReader(ref.Mode)
		if err != nil {
			return nil, internalError(err)
		}
		if _, err := reader.Style(ref); err != nil {
			return nil, internalError(err)
		}
	}
	out := make([]openapi.RoomEventEnvelope, 0, len(events))
	charCache := map[string]map[string]game.Character{}
	memberSlotByID := map[string]int32{}
	for _, m := range state.Members {
		memberSlotByID[m.ID] = int32(multi.MemberSeat(m))
	}

	for _, event := range events {
		projected, skip, err := multi.ProjectEvent(ctx, s.q, s.projectionSecret, event, state.Room.ID, observer, memberSlotByID, charCache)
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
func toOpenAPIFeedbackStatuses(statuses []string) []openapi.FeedbackStatus {
	out := make([]openapi.FeedbackStatus, len(statuses))
	for i, s := range statuses {
		out[i] = openapi.FeedbackStatus(s)
	}
	return out
}

func toOpenAPIGuessFieldKeys(keys []game.GuessFieldKey) []openapi.GuessFieldKey {
	out := make([]openapi.GuessFieldKey, len(keys))
	for i, key := range keys {
		out[i] = openapi.GuessFieldKey(key)
	}
	return out
}

func eventID(event repo.RoomEvent) string {
	return fmt.Sprintf("%d", event.ID)
}
