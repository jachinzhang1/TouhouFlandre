package multi

import (
	"math/rand/v2"
	"testing"
)

func TestTargetWinsAndMaxRounds(t *testing.T) {
	cases := []struct {
		format    RoomFormat
		target    int
		maxRounds int
	}{
		{RoomFormatBO1, 1, 3},
		{RoomFormatBO3, 2, 9},
		{RoomFormatBO5, 3, 15},
		{RoomFormatBO7, 4, 21},
	}
	for _, c := range cases {
		if got := TargetWins(c.format); got != c.target {
			t.Errorf("TargetWins(%s) = %d, want %d", c.format, got, c.target)
		}
		if got := MaxRounds(c.format, 3); got != c.maxRounds {
			t.Errorf("MaxRounds(%s, 3) = %d, want %d", c.format, got, c.maxRounds)
		}
	}
}

func TestSettleRoundEnd(t *testing.T) {
	cases := []struct {
		name       string
		winnerSlot int
		counts     [2]int
		maxGuesses int
		timedOut   bool
		wantEnded  bool
		wantWinner int
	}{
		{"猜中立即结束", 1, [2]int{1, 0}, 8, false, true, 1},
		{"对手猜中", 2, [2]int{1, 1}, 8, false, true, 2},
		{"双方用尽平局", 0, [2]int{8, 8}, 8, false, true, 0},
		{"一方用尽未结束", 0, [2]int{8, 5}, 8, false, false, 0},
		{"超时平局", 0, [2]int{3, 2}, 8, true, true, 0},
		{"超时且已有人猜中（不应发生，猜中优先）", 1, [2]int{3, 2}, 8, true, true, 1},
		{"未结束", 0, [2]int{1, 0}, 8, false, false, 0},
	}
	for _, c := range cases {
		got := SettleRoundEnd(c.winnerSlot, c.counts, c.maxGuesses, c.timedOut)
		if got.Ended != c.wantEnded || got.WinnerSlot != c.wantWinner {
			t.Errorf("%s: got %+v, want ended=%v winner=%d", c.name, got, c.wantEnded, c.wantWinner)
		}
	}
}

func TestAdvanceMatch(t *testing.T) {
	cases := []struct {
		name     string
		score    [2]int
		target   int
		roundCnt int
		maxRnd   int
		winner   int
		want     MatchAdvance
	}{
		{"bo1 首局胜 → match ended", [2]int{0, 0}, 1, 1, 3, 1, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonNormal, WinnerSlot: 1, Score: [2]int{1, 0}}},
		{"bo3 2-0 → match ended", [2]int{1, 0}, 2, 2, 9, 1, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonNormal, WinnerSlot: 1, Score: [2]int{2, 0}}},
		{"bo3 1-0 → 继续", [2]int{1, 0}, 2, 2, 9, 0, MatchAdvance{Score: [2]int{1, 0}}},
		{"平局未达上限 → 继续", [2]int{0, 0}, 2, 2, 9, 0, MatchAdvance{Score: [2]int{0, 0}}},
		{"bo1 第 3 局平局 → round_cap", [2]int{0, 0}, 1, 3, 3, 0, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonRoundCap, Score: [2]int{0, 0}}},
		{"bo7 第 21 局平局 → round_cap", [2]int{3, 3}, 4, 21, 21, 0, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonRoundCap, Score: [2]int{3, 3}}},
		{"第 21 局胜者达 target → normal", [2]int{3, 3}, 4, 21, 21, 1, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonNormal, WinnerSlot: 1, Score: [2]int{4, 3}}},
		{"第 21 局胜者未达 target（不可达但防御）→ round_cap", [2]int{2, 3}, 4, 21, 21, 1, MatchAdvance{MatchEnded: true, Reason: MatchEndReasonRoundCap, Score: [2]int{3, 3}}},
	}
	for _, c := range cases {
		got := AdvanceMatch(c.score, c.target, c.roundCnt, c.maxRnd, c.winner)
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestRelayFirstTurnSlot(t *testing.T) {
	cases := map[int]int{
		1: 1,
		2: 2,
		3: 1,
		4: 2,
	}
	for roundIndex, want := range cases {
		if got := RelayFirstTurnSlot(roundIndex); got != want {
			t.Errorf("RelayFirstTurnSlot(%d) = %d, want %d", roundIndex, got, want)
		}
	}
}

func TestAdvanceRelayTurn(t *testing.T) {
	cases := []struct {
		name    string
		correct bool
		slot    int
		counts  [2]int
		want    RelayTurnAdvance
	}{
		{"猜中立即胜局", true, 1, [2]int{1, 0}, RelayTurnAdvance{RoundEnded: true, WinnerSlot: 1}},
		{"错误后切给对方", false, 1, [2]int{1, 0}, RelayTurnAdvance{NextTurnSlot: 2}},
		{"对方机会已尽则自己继续", false, 1, [2]int{7, 8}, RelayTurnAdvance{NextTurnSlot: 1}},
		{"双方机会耗尽平局", false, 2, [2]int{8, 8}, RelayTurnAdvance{RoundEnded: true}},
	}
	for _, c := range cases {
		got := AdvanceRelayTurn(c.correct, c.slot, c.counts, 8)
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestDrawAnswer(t *testing.T) {
	rng := rand.New(rand.NewPCG(1, 2))
	pool := []string{"a", "b", "c", "d", "e"}

	// 排除已用
	used := map[string]bool{"a": true, "b": true}
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		id, err := DrawAnswer(pool, used, rng)
		if err != nil {
			t.Fatal(err)
		}
		if used[id] {
			t.Fatalf("DrawAnswer 返回已用答案 %s", id)
		}
		seen[id] = true
	}
	if len(seen) != 3 {
		t.Fatalf("期望从剩余 3 个中选取，实际覆盖 %d", len(seen))
	}

	// 空池
	if _, err := DrawAnswer(nil, nil, rng); err != ErrNoAnswerPool {
		t.Fatalf("空池错误 = %v, want ErrNoAnswerPool", err)
	}

	// 池空兜底复用
	allUsed := map[string]bool{"a": true, "b": true, "c": true, "d": true, "e": true}
	id, err := DrawAnswer(pool, allUsed, rng)
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Fatal("兜底返回空")
	}
}
