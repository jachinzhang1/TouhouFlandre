// 逐观察者投影（08 §4.5）：列置换 + 匿名矩阵 + 猜测棋盘水合。
// 快照、事件重放、实时推送三处共用本文件的纯函数（Phase 4 hub 复用）。
package multi

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math/rand/v2"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// EventBroadcaster 事件广播器（Phase 4 hub 实现；sweeper 事件入库后调用，先入库后广播，07 §7.2）。
type EventBroadcaster interface {
	Publish(roomID string)
}

// ColumnPermutation 对 n 列做确定性 Fisher–Yates 置换（08 §4.5）。
// 种子 = FNV-1a(roundID + "\x00" + observerMemberID)：同一 (round, observer) 恒定，
// 保证快照/重放/实时三路径一致且跨进程重启稳定；每局每观察者独立。
func ColumnPermutation(roundID, observerMemberID string, n int) []int {
	h := fnv.New64a()
	_, _ = h.Write([]byte(roundID))
	_, _ = h.Write([]byte{0})
	_, _ = h.Write([]byte(observerMemberID))
	seed := h.Sum64()
	rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	perm := make([]int, n)
	for i := range perm {
		perm[i] = i
	}
	rng.Shuffle(n, func(i, j int) { perm[i], perm[j] = perm[j], perm[i] })
	return perm
}

// PermuteStatuses 按置换重排状态序列（真实列序 → 观察者列序）。
func PermuteStatuses(statuses []string, perm []int) []string {
	out := make([]string, len(statuses))
	for i, p := range perm {
		if i < len(statuses) && p < len(statuses) {
			out[i] = statuses[p]
		}
	}
	return out
}

func StatusesForFields(statuses []string, fields []game.GuessField) []string {
	if len(statuses) == len(fields) {
		return append([]string{}, statuses...)
	}
	indexByField := map[game.GuessFieldKey]int{}
	for index, field := range game.CharacterGuessFields {
		indexByField[field.Key] = index
	}
	out := make([]string, 0, len(fields))
	for index, field := range fields {
		status := "miss"
		if fullIndex, ok := indexByField[field.Key]; ok && fullIndex < len(statuses) {
			status = statuses[fullIndex]
		} else if index < len(statuses) {
			status = statuses[index]
		}
		out = append(out, status)
	}
	return out
}

// HydrateGuessResult 由存储的状态序列（真实列序）重建完整猜测反馈
// （08 §4.3：标签/符号/展示值按快照在投影时恢复，与单人旧猜测恢复同源）。
// isCorrect 来自存储行（自视角展示；对手匿名矩阵不渲染该字段）。
func HydrateGuessResult(guess game.Character, statuses []string, isCorrect bool) game.GuessResult {
	return HydrateGuessResultWithFields(guess, statuses, isCorrect, game.CharacterGuessFields)
}

func HydrateGuessResultWithFields(guess game.Character, statuses []string, isCorrect bool, fields []game.GuessField) game.GuessResult {
	visibleStatuses := StatusesForFields(statuses, fields)
	feedback := make([]game.FieldFeedback, 0, len(fields))
	for i, field := range fields {
		if !field.Visible {
			continue
		}
		status := game.FeedbackStatus("miss")
		if i < len(visibleStatuses) {
			status = game.FeedbackStatus(visibleStatuses[i])
		}
		feedback = append(feedback, game.FieldFeedback{
			Field:        field.Key,
			Label:        field.Label,
			Status:       status,
			Symbol:       game.StatusToSymbol(status),
			DisplayValue: game.DisplayValuesForField(guess, field.Key),
		})
	}
	return game.GuessResult{
		GuessID:        guess.ID,
		GuessName:      guess.Names.ZhHans,
		GuessAvatarURL: guess.AvatarURL,
		IsCorrect:      isCorrect,
		Feedback:       feedback,
	}
}

// ProjectEvent 按观察者投影单个事件为 wire 形状（快照/重放/实时三路径共用）。
// - round.opponent.guess：仅对手可见（memberSlot == observer 跳过）、列置换、剥离内部字段；
// - round.ended：result 按观察者推导 + 答案与双方完整棋盘水合（按快照）；
// - match.ended：result 按观察者推导；
// - 其余事件原样返回（payload map）。
// charsCache 跨事件共享角色索引（避免重复读快照）；memberSlotByID 用于棋盘按 slot 分组。
func ProjectEvent(ctx context.Context, q *repo.Queries, event repo.RoomEvent, roomID string,
	observer repo.MultiMember, memberSlotByID map[string]int32, charsCache map[string]map[string]game.Character) (any, bool, error) {

	switch EventType(event.Type) {
	case EventRoundOpponentGuess:
		var payload RoundGuessPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return nil, false, err
		}
		if payload.MemberSlot == int(observer.Slot) {
			return nil, true, nil // 自己的猜测不回放（自视角以 REST 响应为准）
		}
		match, err := q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: roomID, MatchIndex: int32(payload.MatchIndex)})
		if err != nil {
			return nil, false, err
		}
		fields := FieldsForMatch(match)
		visibleStatuses := StatusesForFields(payload.Statuses, fields)
		perm := ColumnPermutation(payload.RoundID, observer.ID, len(fields))
		return RoundOpponentGuessPayload{
			MatchIndex: payload.MatchIndex,
			RoundIndex: payload.RoundIndex,
			RowIndex:   payload.RowIndex,
			Statuses:   PermuteStatuses(visibleStatuses, perm),
		}, false, nil

	case EventRoundEnded:
		var payload RoundEndedEventPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return nil, false, err
		}
		round, err := q.GetRound(ctx, payload.RoundID)
		if err != nil {
			return nil, false, err
		}
		match, err := q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: roomID, MatchIndex: int32(payload.MatchIndex)})
		if err != nil {
			return nil, false, err
		}
		chars, err := charactersForVersionCached(ctx, q, match.CatalogVersion, charsCache)
		if err != nil {
			return nil, false, err
		}
		fields := FieldsForMatch(match)
		guesses, err := q.ListGuessesForRound(ctx, round.ID)
		if err != nil {
			return nil, false, err
		}
		turns, err := q.ListTurnsForRound(ctx, round.ID)
		if err != nil {
			return nil, false, err
		}
		relayRows, err := HydrateRelayTurnRowsWithFields(turns, chars, memberSlotByID, fields)
		if err != nil {
			return nil, false, err
		}
		answer := chars[payload.AnswerID]
		return RoundEndedPayload{
			MatchIndex:   payload.MatchIndex,
			RoundIndex:   payload.RoundIndex,
			Result:       resultForObserver(payload.WinnerSlot, int(observer.Slot)),
			WinnerSlot:   payload.WinnerSlot,
			Answer:       AnswerViewForCharacter(answer),
			Boards:       hydrateBoards(guesses, chars, memberSlotByID, fields),
			Turns:        relayRows,
			Scores:       payload.Scores,
			NextStartsAt: payload.NextStartsAt,
		}, false, nil

	case EventMatchEnded:
		var payload MatchEndedEventPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return nil, false, err
		}
		return MatchEndedPayload{
			MatchIndex: payload.MatchIndex,
			Result:     resultForObserver(payload.WinnerSlot, int(observer.Slot)),
			WinnerSlot: payload.WinnerSlot,
			Scores:     payload.Scores,
			Reason:     payload.Reason,
		}, false, nil

	default:
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return nil, false, err
		}
		return payload, false, nil
	}
}

// AnswerViewForCharacter 从场绑定题库快照构造稳定的局末答案视图。
func AnswerViewForCharacter(answer game.Character) AnswerView {
	workCode := "TH--"
	if answer.FirstAppearance.MainlineIndex != nil {
		workCode = fmt.Sprintf("TH%02d", *answer.FirstAppearance.MainlineIndex)
	}
	return AnswerView{
		ID: answer.ID, Name: answer.Names.ZhHans, AvatarURL: answer.AvatarURL,
		WorkID: answer.FirstAppearance.WorkID, WorkTitle: answer.FirstAppearance.WorkTitle, WorkCode: workCode,
	}
}

// charactersForVersionCached 读取并缓存版本角色索引。
func charactersForVersionCached(ctx context.Context, q *repo.Queries, version string, cache map[string]map[string]game.Character) (map[string]game.Character, error) {
	if chars, ok := cache[version]; ok {
		return chars, nil
	}
	characters, err := CharactersForVersion(ctx, q, version)
	if err != nil {
		return nil, err
	}
	chars := CharactersByID(characters)
	cache[version] = chars
	return chars, nil
}

// hydrateBoards 局末双方完整棋盘（按成员 slot 分组、时间序）。
func hydrateBoards(guesses []repo.MultiGuess, chars map[string]game.Character, memberSlotByID map[string]int32, fieldSets ...[]game.GuessField) BoardsView {
	fields := game.CharacterGuessFields
	if len(fieldSets) > 0 {
		fields = fieldSets[0]
	}
	// 空槽必须序列化为 []（JSON 数组），不能是 nil（null）——前端按数组消费。
	boards := BoardsView{
		Slot1: []GuessResultView{},
		Slot2: []GuessResultView{},
	}
	for _, guess := range guesses {
		var statuses []string
		if err := json.Unmarshal(guess.Statuses, &statuses); err != nil {
			continue
		}
		guessChar, ok := chars[guess.GuessID]
		if !ok {
			continue
		}
		hydrated := HydrateGuessResultViewWithFields(guessChar, statuses, guess.IsCorrect, fields)
		if memberSlotByID[guess.MemberID] == 1 {
			boards.Slot1 = append(boards.Slot1, hydrated)
		} else {
			boards.Slot2 = append(boards.Slot2, hydrated)
		}
	}
	return boards
}

// resultForObserver 由 winnerSlot 推导观察者视角结果（win/loss/draw）。
func resultForObserver(winnerSlot *int, observerSlot int) MatchResult {
	if winnerSlot == nil {
		return MatchResultDraw
	}
	if *winnerSlot == observerSlot {
		return MatchResultWin
	}
	return MatchResultLoss
}
