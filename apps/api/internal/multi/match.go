// 对局纯逻辑（08 §4.2/§6.1/§6.3）：赛制数学、抽题、单局结算与场次推进。
// 全部为纯函数（固定时钟/固定输入，表驱动单测），不触 DB/HTTP。
package multi

import (
	"errors"
)

// ErrNoAnswerPool 可答池为空且无兜底。
var ErrNoAnswerPool = errors.New("answer pool is empty")

// FormatNumber 赛制对应的 N（08 §4.2：bo1→1、bo3→3、bo5→5、bo7→7）。
func FormatNumber(format RoomFormat) int {
	switch format {
	case RoomFormatBO1:
		return 1
	case RoomFormatBO3:
		return 3
	case RoomFormatBO5:
		return 5
	case RoomFormatBO7:
		return 7
	}
	return 0
}

// TargetWins 目标胜场 = (N+1)/2（08 §4.2：bo1→1、bo3→2、bo5→3、bo7→4）。
func TargetWins(format RoomFormat) int {
	switch format {
	case RoomFormatBO1:
		return 1
	case RoomFormatBO3:
		return 2
	case RoomFormatBO5:
		return 3
	case RoomFormatBO7:
		return 4
	}
	return 0
}

// MaxRounds 总局数安全上限 = factor × N（08 §4.2：factor=3 → bo1→3、bo3→9、bo5→15、bo7→21）。
func MaxRounds(format RoomFormat, factor int) int {
	return factor * FormatNumber(format)
}

// TotalRounds 冻结的总局数 = 赛制对应的 1/3/5/7。
func TotalRounds(format RoomFormat) int {
	return FormatNumber(format)
}

// RoundEnd 单局结算结果（winnerSlot 0 = 平局/未决）。
type RoundEnd struct {
	Ended      bool
	WinnerSlot int
}

// SettleRoundEnd 单局结束判定（08 §4.4，优先级从高到低）：
// 1. 猜中（winnerSlot != 0）→ 立即结束，胜者 = winnerSlot；
// 2. 双方用尽（各 maxGuesses 且无人猜中）→ 平局；
// 3. 整局超时（timedOut）→ 平局。
func SettleRoundEnd(winnerSlot int, guessCounts [2]int, maxGuesses int, timedOut bool) RoundEnd {
	if winnerSlot != 0 {
		return RoundEnd{Ended: true, WinnerSlot: winnerSlot}
	}
	if timedOut {
		return RoundEnd{Ended: true}
	}
	if guessCounts[0] >= maxGuesses && guessCounts[1] >= maxGuesses {
		return RoundEnd{Ended: true}
	}
	return RoundEnd{}
}

// RelayFirstTurnSlot 接力模式逐局交替先手：奇数局 slot 1，偶数局 slot 2。
func RelayFirstTurnSlot(roundIndex int) int {
	if roundIndex%2 == 0 {
		return 2
	}
	return 1
}

// OtherSlot 返回两人房间中的另一方 slot。
func OtherSlot(slot int) int {
	if slot == 1 {
		return 2
	}
	return 1
}

// RelayTurnAdvance 接力一次猜测/空过后的推进结果。
type RelayTurnAdvance struct {
	RoundEnded   bool
	WinnerSlot   int
	NextTurnSlot int
}

// AdvanceRelayTurn 接力模式在当前玩家已消耗一次轮次后推进。
// counts 为消耗后的双方轮次计数；isCorrect 优先立即结束本局。
func AdvanceRelayTurn(isCorrect bool, memberSlot int, counts [2]int, maxTurnsPerPlayer int) RelayTurnAdvance {
	if isCorrect {
		return RelayTurnAdvance{RoundEnded: true, WinnerSlot: memberSlot}
	}
	if counts[0] >= maxTurnsPerPlayer && counts[1] >= maxTurnsPerPlayer {
		return RelayTurnAdvance{RoundEnded: true}
	}
	next := OtherSlot(memberSlot)
	if counts[next-1] < maxTurnsPerPlayer {
		return RelayTurnAdvance{NextTurnSlot: next}
	}
	if counts[memberSlot-1] < maxTurnsPerPlayer {
		return RelayTurnAdvance{NextTurnSlot: memberSlot}
	}
	return RelayTurnAdvance{RoundEnded: true}
}

// MatchAdvance 场次级推进结果。
type MatchAdvance struct {
	MatchEnded bool
	Reason     MatchEndReason
	WinnerSlot int    // 0 = 平局
	Score      [2]int // 本局结算后的比分
}

// AdvanceMatch 局结束后的场次推进（08 §4.2/§9.2 步骤 8）：
// - 本局有胜者：比分 +1；达到 targetWins → match.ended(normal, 该胜者)；
// - 否则若已开满 maxRounds 局仍无胜者 → match.ended(round_cap, 平局)；
// - 否则 → 继续下一局（sweeper 按 INTERMISSION 开新局）。
// score 为局结束前比分；返回的 Score 已含本局结算。
func AdvanceMatch(score [2]int, targetWins, roundCount, maxRounds, roundWinnerSlot int) MatchAdvance {
	if roundWinnerSlot != 0 {
		score[roundWinnerSlot-1]++
		if score[roundWinnerSlot-1] >= targetWins {
			return MatchAdvance{MatchEnded: true, Reason: MatchEndReasonNormal, WinnerSlot: roundWinnerSlot, Score: score}
		}
	}
	if roundCount >= maxRounds {
		return MatchAdvance{MatchEnded: true, Reason: MatchEndReasonRoundCap, Score: score}
	}
	return MatchAdvance{Score: score}
}

// DrawAnswer 从可答池排除本场已用答案后随机选取（08 §6.1）；
// 池空防御性兜底允许复用（正常对局不可能触达，113 角色 × 上限 21 局）。
func DrawAnswer(pool []string, used map[string]bool, rng interface{ IntN(int) int }) (string, error) {
	if len(pool) == 0 {
		return "", ErrNoAnswerPool
	}
	candidates := make([]string, 0, len(pool))
	for _, id := range pool {
		if !used[id] {
			candidates = append(candidates, id)
		}
	}
	if len(candidates) == 0 {
		// 防御性兜底：复用（允许重复答案）
		return pool[rng.IntN(len(pool))], nil
	}
	return candidates[rng.IntN(len(candidates))], nil
}

// DrawAnswerByGroup excludes every candidate whose equivalence group has
// already appeared in the match. Exhaustion is reported instead of silently
// reusing an equivalent answer.
func DrawAnswerByGroup(pool, usedIDs []string, groupKey func(string) string, rng interface{ IntN(int) int }) (string, error) {
	if len(pool) == 0 {
		return "", ErrNoAnswerPool
	}
	usedGroups := make(map[string]struct{}, len(usedIDs))
	for _, id := range usedIDs {
		usedGroups[groupKey(id)] = struct{}{}
	}
	seenGroups := make(map[string]struct{}, len(pool))
	candidates := make([]string, 0, len(pool))
	for _, id := range pool {
		group := groupKey(id)
		if _, used := usedGroups[group]; used {
			continue
		}
		if _, duplicate := seenGroups[group]; duplicate {
			continue
		}
		seenGroups[group] = struct{}{}
		candidates = append(candidates, id)
	}
	if len(candidates) == 0 {
		return "", ErrNoAnswerPool
	}
	return candidates[rng.IntN(len(candidates))], nil
}
