// 逐观察者投影（08 §4.5）：列置换 + 匿名矩阵 + 猜测棋盘水合。
// 快照、事件重放、实时推送三处共用本文件的纯函数（Phase 4 hub 复用）。
package multi

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/rand/v2"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

const ProjectionSchemaVersion = "opponent-board-v1"

// EventBroadcaster 事件广播器（Phase 4 hub 实现；sweeper 事件入库后调用，先入库后广播，07 §7.2）。
type EventBroadcaster interface {
	Publish(roomID string)
}

// ColumnPermutation 对 n 列做确定性 Fisher–Yates 置换（08 §4.5）。
// HMAC 输入绑定 round、observer、subject 与 schemaVersion：同一投影视角三路径恒定，
// 不同对手之间也无法用同一列顺序建立相关性；服务端秘密阻止客户端反推真实列映射。
func ColumnPermutation(secret []byte, roundID, observerMemberID, subjectMemberID, schemaVersion string, n int) []int {
	mac := hmac.New(sha256.New, secret)
	for _, part := range []string{roundID, observerMemberID, subjectMemberID, schemaVersion} {
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(part)))
		_, _ = mac.Write(length[:])
		_, _ = mac.Write([]byte(part))
	}
	digest := mac.Sum(nil)
	seed1 := binary.BigEndian.Uint64(digest[:8])
	seed2 := binary.BigEndian.Uint64(digest[8:16])
	rng := rand.New(rand.NewPCG(seed1, seed2))
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

func PermuteFieldOrder(fields []game.GuessField, perm []int) []game.GuessFieldKey {
	out := make([]game.GuessFieldKey, len(fields))
	for i, p := range perm {
		if i < len(fields) && p < len(fields) {
			out[i] = fields[p].Key
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

type ProjectedEvent struct {
	Type    EventType
	Payload any
}

// ProjectEvent 按观察者投影单个事件为 wire 形状（快照/重放/实时三路径共用）。
// - round.opponent.guess：仅对手可见（memberSlot == observer 跳过），列置换并适配为 memberId + seat；
// - round.ended：补 viewerResult、答案和按 seat 排序的棋盘/比分/结果集合；
// - match.ended：补 viewerResult 和按 seat 排序的比分/结果集合；
// - 其余事件原样返回（payload map）。
// charsCache 跨事件共享角色索引（避免重复读快照）；memberSlotByID 是旧比赛存储到公开 seat 的适配表。
func ProjectEvent(ctx context.Context, q *repo.Queries, projectionSecret []byte, event repo.RoomEvent, roomID string,
	observer repo.MultiMember, memberSlotByID map[string]int32, charsCache map[string]map[string]game.Character) (ProjectedEvent, bool, error) {

	switch EventType(event.Type) {
	case EventMatchStarted:
		var payload MatchStartedPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		if err := normalizeMatchStartedRuleSet(&payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		return ProjectedEvent{Type: EventMatchStarted, Payload: payload}, false, nil

	case EventRoundOpponentGuess:
		var payload RoundGuessPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		match, err := q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: roomID, MatchIndex: int32(payload.MatchIndex)})
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		fullBoardVisibility := IsSpectator(observer)
		if !fullBoardVisibility && IsPlayer(observer) {
			matchPlayer, err := q.GetMatchPlayer(ctx, repo.GetMatchPlayerParams{MatchID: match.ID, MemberID: observer.ID})
			if err == nil {
				fullBoardVisibility = matchPlayer.Status != "active"
			}
		}
		if fullBoardVisibility {
			projected, err := projectSpectatorGuess(ctx, q, roomID, payload, memberSlotByID, charsCache)
			return projected, false, err
		}
		if payload.MemberSlot == MemberSeat(observer) {
			return ProjectedEvent{}, true, nil // 自己的猜测不回放（自视角以 REST 响应为准）
		}
		fields := FieldsForMatch(match)
		visibleStatuses := StatusesForFields(payload.Statuses, fields)
		perm := ColumnPermutation(projectionSecret, payload.RoundID, observer.ID, payload.MemberID, ProjectionSchemaVersion, len(fields))
		return ProjectedEvent{
			Type: EventRoundOpponentGuess,
			Payload: RoundOpponentGuessPayload{
				MatchIndex: payload.MatchIndex,
				RoundIndex: payload.RoundIndex,
				MemberID:   payload.MemberID,
				Seat:       payload.MemberSlot,
				RowIndex:   payload.RowIndex,
				FieldOrder: PermuteFieldOrder(fields, perm),
				Statuses:   PermuteStatuses(visibleStatuses, perm),
			},
		}, false, nil

	case EventRoundEnded:
		var payload RoundEndedEventPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		round, err := q.GetRound(ctx, payload.RoundID)
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		match, err := q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: roomID, MatchIndex: int32(payload.MatchIndex)})
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		chars, err := charactersForVersionCached(ctx, q, match.CatalogVersion, charsCache)
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		fields := FieldsForMatch(match)
		guesses, err := q.ListGuessesForRound(ctx, round.ID)
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		turns, err := q.ListTurnsForRound(ctx, round.ID)
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		relayRows, err := HydrateRelayTurnRowsWithFields(turns, chars, memberSlotByID, fields)
		if err != nil {
			return ProjectedEvent{}, false, err
		}
		answer := chars[payload.AnswerID]
		winnerMemberID := payload.WinnerMemberID
		if winnerMemberID == nil {
			winnerMemberID = optionalMemberIDForSeat(payload.WinnerSlot, memberSlotByID)
		}
		forfeitedMemberID := payload.ForfeitedMemberID
		if forfeitedMemberID == nil {
			forfeitedMemberID = optionalMemberIDForSeat(payload.ForfeitedSlot, memberSlotByID)
		}
		scores := payload.MemberScores
		if len(scores) == 0 {
			scores = MemberScoresForLegacy(payload.Scores, memberSlotByID)
		}
		results := MemberResults(winnerMemberID, memberSlotByID)
		var viewerResult *MatchResult
		if IsPlayer(observer) {
			viewerResult = ViewerResultForMember(observer.ID, results)
		}
		return ProjectedEvent{
			Type: EventRoundEnded,
			Payload: RoundEndedPayload{
				MatchIndex:          payload.MatchIndex,
				RoundIndex:          payload.RoundIndex,
				ViewerResult:        viewerResult,
				WinnerMemberID:      winnerMemberID,
				ForfeitedMemberID:   forfeitedMemberID,
				Answer:              AnswerViewForCharacter(answer),
				Boards:              hydrateBoards(guesses, chars, memberSlotByID, fields),
				Turns:               relayRows,
				Scores:              scores,
				Results:             results,
				NextStartsAt:        payload.NextStartsAt,
				Placements:          payload.Placements,
				EliminatedMemberIDs: payload.EliminatedMemberIDs,
			},
		}, false, nil

	case EventMatchEnded:
		var payload MatchEndedEventPayload
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		winnerMemberID := payload.WinnerMemberID
		if winnerMemberID == nil {
			winnerMemberID = optionalMemberIDForSeat(payload.WinnerSlot, memberSlotByID)
		}
		scores := payload.MemberScores
		if len(scores) == 0 {
			scores = MemberScoresForLegacy(payload.Scores, memberSlotByID)
		}
		results := MemberResultsForRanking(winnerMemberID, payload.Ranking, memberSlotByID)
		var viewerResult *MatchResult
		if IsPlayer(observer) {
			viewerResult = ViewerResultForMember(observer.ID, results)
		}
		return ProjectedEvent{
			Type: EventMatchEnded,
			Payload: MatchEndedPayload{
				MatchIndex:      payload.MatchIndex,
				ViewerResult:    viewerResult,
				WinnerMemberID:  winnerMemberID,
				Scores:          scores,
				Results:         results,
				Reason:          payload.Reason,
				RetentionEndsAt: payload.RetentionEndsAt,
				Ranking:         payload.Ranking,
			},
		}, false, nil

	default:
		var payload map[string]any
		if err := json.Unmarshal(event.Payload, &payload); err != nil {
			return ProjectedEvent{}, false, err
		}
		return ProjectedEvent{Type: EventType(event.Type), Payload: payload}, false, nil
	}
}

func normalizeMatchStartedRuleSet(payload *MatchStartedPayload) error {
	ref := payload.RuleSetRef
	if ref.Mode == "" && ref.Key == "" && ref.Version == 0 {
		ref.Mode = payload.Mode
		ref.Version = 1
		switch {
		case payload.Mode == MultiplayerModeRace && (payload.ScoringMode == ScoringModeWins || payload.ScoringMode == ScoringModePoints || payload.ScoringMode == ScoringModePlacement):
			ref.Key = string(payload.ScoringMode)
		case payload.Mode == MultiplayerModeRelay && payload.ScoringMode == ScoringModeWins:
			ref.Key = "legacy_wins"
		default:
			return fmt.Errorf("match.started legacy rule-set mapping rejected: mode=%s scoring_mode=%s", payload.Mode, payload.ScoringMode)
		}
		payload.RuleSetRef = ref
		return nil
	}
	if ref.Mode == "" || ref.Key == "" || ref.Version <= 0 || ref.Mode != payload.Mode {
		return fmt.Errorf("match.started has invalid ruleSetRef: mode=%s key=%s version=%d", ref.Mode, ref.Key, ref.Version)
	}
	return nil
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

func projectSpectatorGuess(ctx context.Context, q *repo.Queries, roomID string, payload RoundGuessPayload,
	memberSlotByID map[string]int32, charsCache map[string]map[string]game.Character) (ProjectedEvent, error) {
	match, err := q.GetMatchByIndex(ctx, repo.GetMatchByIndexParams{RoomID: roomID, MatchIndex: int32(payload.MatchIndex)})
	if err != nil {
		return ProjectedEvent{}, err
	}
	round, err := q.GetRound(ctx, payload.RoundID)
	if err != nil {
		return ProjectedEvent{}, err
	}
	guessID := payload.GuessID
	statuses := append([]string{}, payload.Statuses...)
	isCorrect := guessID != "" && guessID == round.AnswerID
	if guessID == "" {
		guesses, err := q.ListGuessesForRound(ctx, payload.RoundID)
		if err != nil {
			return ProjectedEvent{}, err
		}
		for _, guess := range guesses {
			if int(memberSlotByID[guess.MemberID]) != payload.MemberSlot || int(guess.Sequence) != payload.RowIndex {
				continue
			}
			guessID = guess.GuessID
			isCorrect = guess.IsCorrect
			if err := json.Unmarshal(guess.Statuses, &statuses); err != nil {
				return ProjectedEvent{}, err
			}
			break
		}
	}
	chars, err := charactersForVersionCached(ctx, q, match.CatalogVersion, charsCache)
	if err != nil {
		return ProjectedEvent{}, err
	}
	guessChar, ok := chars[guessID]
	if !ok {
		return ProjectedEvent{}, fmt.Errorf("spectator guess character missing: %s", guessID)
	}
	fields := FieldsForMatch(match)
	return ProjectedEvent{
		Type: EventRoundSpectatorGuess,
		Payload: RoundSpectatorGuessPayload{
			MatchIndex: payload.MatchIndex,
			RoundIndex: payload.RoundIndex,
			MemberID:   payload.MemberID,
			Seat:       payload.MemberSlot,
			RowIndex:   payload.RowIndex,
			Guess:      HydrateGuessResultViewWithFields(guessChar, statuses, isCorrect, fields),
		},
	}, nil
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

// hydrateBoards 局末完整棋盘集合（按 memberId 分组、seat 排序、组内按时间序）。
func hydrateBoards(guesses []repo.MultiGuess, chars map[string]game.Character, memberSlotByID map[string]int32, fieldSets ...[]game.GuessField) []MemberBoardView {
	fields := game.CharacterGuessFields
	if len(fieldSets) > 0 {
		fields = fieldSets[0]
	}
	boards := make([]MemberBoardView, 0, len(memberSlotByID))
	boardIndexByMemberID := make(map[string]int, len(memberSlotByID))
	for _, ref := range orderedMemberRefs(memberSlotByID) {
		boardIndexByMemberID[ref.MemberID] = len(boards)
		boards = append(boards, MemberBoardView{
			MemberID: ref.MemberID,
			Seat:     ref.Seat,
			Guesses:  []GuessResultView{},
		})
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
		if index, ok := boardIndexByMemberID[guess.MemberID]; ok {
			boards[index].Guesses = append(boards[index].Guesses, hydrated)
		}
	}
	return boards
}

func optionalMemberIDForSeat(seat *int, memberSeatByID map[string]int32) *string {
	if seat == nil {
		return nil
	}
	return memberIDForSeat(memberSeatByID, *seat)
}
