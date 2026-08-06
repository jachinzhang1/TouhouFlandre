// 房间快照（08 §7.3 逐观察者投影）：match/round 视图 + 事件重放投影。
// 数据源 = GetRoomSnapshotState（jsonb_agg 单查询）；展示水合与列置换在 Go 投影层完成。
package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"


	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// snapshotState GetRoomSnapshotState 的解析形态（键为 jsonb_build_object 的键名）。
// 注意：to_jsonb 把 multi_guess.statuses（jsonb 数组）渲染为 JSON 数组，不能直接
// unmarshal 进 repo.MultiGuess.Statuses（[]byte）——用快照专用形态承接。
type snapshotState struct {
	Room    repo.MultiRoom     `json:"room"`
	Members []repo.MultiMember `json:"members"`
	Match   *repo.MultiMatch   `json:"match"`
	Round   *repo.MultiRound   `json:"round"`
	Guesses []snapshotGuess    `json:"guesses"`
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
		RoomId:   state.Room.ID,
		RoomCode: state.Room.Code,
		Format:   openapi.RoomFormat(state.Room.Format),
		Status:   openapi.RoomStatus(state.Room.Status),
		Members:  memberViews,
	}

	if state.Match != nil {
		format := multi.RoomFormat(state.Room.Format)
		roundIndex := 0
		if state.Round != nil {
			roundIndex = int(state.Round.RoundIndex)
		}
		rematchReady := [2]bool{}
		for _, m := range state.Members {
			if m.Slot == 1 {
				rematchReady[0] = m.RematchReady
			} else {
				rematchReady[1] = m.RematchReady
			}
		}
		matchView := openapi.MatchView{
			MatchIndex:  int(state.Match.MatchIndex),
			TargetWins:  int(state.Match.TargetWins),
			ScoreSlot1:  int(state.Match.ScoreSlot1),
			ScoreSlot2:  int(state.Match.ScoreSlot2),
			RoundIndex:  roundIndex,
			MaxRounds:   multi.MaxRounds(format, s.timing.MaxRoundsFactor),
			RematchReady: rematchReady[:],
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
	perm := multi.ColumnPermutation(state.Round.ID, observer.ID, len(game.CharacterGuessFields))

	self := []openapi.GuessResult{}
	opponentRows := []openapi.OpponentRow{} // 空对手矩阵序列化为 []（前端按数组消费）
	for _, guess := range state.Guesses {
		statuses := guess.Statuses
		guessChar, ok := byID[guess.GuessID]
		if !ok {
			return nil, internalError(errors.New("guess character missing from snapshot"))
		}
		if guess.MemberID == observer.ID {
			hydrated := multi.HydrateGuessResult(guessChar, statuses, guess.IsCorrect)
			self = append(self, toOpenAPIGuessResult(hydrated))
		} else {
			opponentRows = append(opponentRows, openapi.OpponentRow{
				Index:    int(guess.Sequence),
				Statuses: toOpenAPIFeedbackStatuses(multi.PermuteStatuses(statuses, perm)),
			})
		}
	}
	roundView := openapi.RoundView{
		Status:     openapi.RoundStatus(state.Round.Status),
		StartsAt:   state.Round.StartsAt.Time,
		Deadline:   state.Round.Deadline.Time,
		MaxGuesses: multi.GameMaxGuesses,
	}
	roundView.Self.Guesses = self
	roundView.Opponent.Rows = opponentRows
	return &roundView, nil
}

// projectEvents 事件重放投影（08 §4.5 三路径共用投影语义）：
// round.opponent.guess 仅推对手（剥离 memberSlot/roundID、按观察者列置换）；
// round.ended/match.ended 的 result 按观察者推导（round.ended 另水合答案与双方完整棋盘）。
func (s *Server) projectEvents(ctx context.Context, events []repo.RoomEvent, state snapshotState, observer repo.MultiMember) ([]openapi.RoomEventEnvelope, error) {
	out := make([]openapi.RoomEventEnvelope, 0, len(events))
	charCache := map[string]map[string]game.Character{}
	loadChars := func(version string) (map[string]game.Character, error) {
		if chars, ok := charCache[version]; ok {
			return chars, nil
		}
		characters, err := multi.CharactersForVersion(ctx, s.q, version)
		if err != nil {
			return nil, err
		}
		chars := multi.CharactersByID(characters)
		charCache[version] = chars
		return chars, nil
	}
	memberSlotByID := map[string]int32{}
	for _, m := range state.Members {
		memberSlotByID[m.ID] = m.Slot
	}

	for _, event := range events {
		switch event.Type {
		case string(multi.EventRoundOpponentGuess):
			var payload multi.RoundGuessPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				return nil, internalError(err)
			}
			if payload.MemberSlot == int(observer.Slot) {
				continue // 自己的猜测不回放（自视角以 REST 响应为准）
			}
			perm := multi.ColumnPermutation(payload.RoundID, observer.ID, len(game.CharacterGuessFields))
			wire := map[string]any{
				"matchIndex": payload.MatchIndex,
				"roundIndex": payload.RoundIndex,
				"rowIndex":   payload.RowIndex,
				"statuses":   toOpenAPIFeedbackStatuses(multi.PermuteStatuses(payload.Statuses, perm)),
			}
			out = append(out, openapi.RoomEventEnvelope{
				Type: event.Type, EventId: eventID(event), RoomId: event.RoomID,
				Sequence: int(event.Sequence), OccurredAt: event.OccurredAt.Time, Payload: wire,
			})
		case string(multi.EventRoundEnded):
			var payload multi.RoundEndedEventPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				return nil, internalError(err)
			}
			round, err := s.q.GetRound(ctx, payload.RoundID)
			if err != nil {
				return nil, internalError(err)
			}
			match, err := s.q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: state.Room.ID, MatchIndex: int32(payload.MatchIndex)})
			if err != nil {
				return nil, internalError(err)
			}
			chars, err := loadChars(match.CatalogVersion)
			if err != nil {
				return nil, err
			}
			guesses, err := s.q.ListGuessesForRound(ctx, round.ID)
			if err != nil {
				return nil, internalError(err)
			}
			answer := chars[payload.AnswerID]
			wire := map[string]any{
				"matchIndex": payload.MatchIndex,
				"roundIndex": payload.RoundIndex,
				"result":     resultForObserver(payload.WinnerSlot, int(observer.Slot)),
				"winnerSlot": payload.WinnerSlot,
				"answer":     map[string]any{"id": answer.ID, "name": answer.Names.ZhHans, "avatarUrl": answer.AvatarURL},
				"boards":     hydrateBoards(guesses, chars, memberSlotByID),
				"scores":     map[string]int{"slot1": payload.Scores.Slot1, "slot2": payload.Scores.Slot2},
			}
			out = append(out, openapi.RoomEventEnvelope{
				Type: event.Type, EventId: eventID(event), RoomId: event.RoomID,
				Sequence: int(event.Sequence), OccurredAt: event.OccurredAt.Time, Payload: wire,
			})
		case string(multi.EventMatchEnded):
			var payload multi.MatchEndedEventPayload
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				return nil, internalError(err)
			}
			wire := map[string]any{
				"matchIndex": payload.MatchIndex,
				"result":     resultForObserver(payload.WinnerSlot, int(observer.Slot)),
				"winnerSlot": payload.WinnerSlot,
				"scores":     map[string]int{"slot1": payload.Scores.Slot1, "slot2": payload.Scores.Slot2},
				"reason":     payload.Reason,
			}
			out = append(out, openapi.RoomEventEnvelope{
				Type: event.Type, EventId: eventID(event), RoomId: event.RoomID,
				Sequence: int(event.Sequence), OccurredAt: event.OccurredAt.Time, Payload: wire,
			})
		default:
			var payload map[string]any
			if err := json.Unmarshal(event.Payload, &payload); err != nil {
				return nil, internalError(err)
			}
			out = append(out, openapi.RoomEventEnvelope{
				Type: event.Type, EventId: eventID(event), RoomId: event.RoomID,
				Sequence: int(event.Sequence), OccurredAt: event.OccurredAt.Time, Payload: payload,
			})
		}
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
