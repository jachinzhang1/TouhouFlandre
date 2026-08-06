// 逐观察者投影（08 §4.5）：列置换 + 匿名矩阵 + 猜测棋盘水合。
// 快照、事件重放、实时推送三处共用本文件的纯函数（Phase 4 hub 复用）。
package multi

import (
	"hash/fnv"
	"math/rand/v2"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
)

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

// HydrateGuessResult 由存储的状态序列（真实列序）重建完整猜测反馈
// （08 §4.3：标签/符号/展示值按快照在投影时恢复，与单人旧猜测恢复同源）。
// isCorrect 来自存储行（自视角展示；对手匿名矩阵不渲染该字段）。
func HydrateGuessResult(guess game.Character, statuses []string, isCorrect bool) game.GuessResult {
	feedback := make([]game.FieldFeedback, 0, len(game.CharacterGuessFields))
	for i, field := range game.CharacterGuessFields {
		if !field.Visible {
			continue
		}
		status := game.FeedbackStatus("miss")
		if i < len(statuses) {
			status = game.FeedbackStatus(statuses[i])
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
