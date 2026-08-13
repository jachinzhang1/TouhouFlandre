package multi

import (
	"encoding/json"
	"testing"
)

func TestColumnPermutationDeterministic(t *testing.T) {
	a := ColumnPermutation("round-1", "member-a", 6)
	b := ColumnPermutation("round-1", "member-a", 6)
	if len(a) != 6 {
		t.Fatalf("perm length %d", len(a))
	}
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("同 (round, observer) 置换不稳定: %v vs %v", a, b)
		}
	}
	// 是合法置换（0..5 各一次）
	seen := [6]bool{}
	for _, v := range a {
		seen[v] = true
	}
	for i, ok := range seen {
		if !ok {
			t.Fatalf("置换缺少元素 %d: %v", i, a)
		}
	}
}

func TestColumnPermutationObserverIndependent(t *testing.T) {
	pa := ColumnPermutation("round-1", "member-a", 6)
	pb := ColumnPermutation("round-1", "member-b", 6)
	same := true
	for i := range pa {
		if pa[i] != pb[i] {
			same = false
			break
		}
	}
	if same {
		t.Fatalf("A/B 观察者置换相同: %v", pa)
	}
	// 不同局不同置换
	pRound2 := ColumnPermutation("round-2", "member-a", 6)
	sameRound := true
	for i := range pa {
		if pa[i] != pRound2[i] {
			sameRound = false
			break
		}
	}
	if sameRound {
		t.Fatalf("不同局的置换相同: %v", pa)
	}
}

func TestPermuteStatuses(t *testing.T) {
	perm := ColumnPermutation("r", "o", 6)
	statuses := []string{"exact", "partial", "miss", "higher", "lower", "unknown"}
	out := PermuteStatuses(statuses, perm)
	if len(out) != 6 {
		t.Fatalf("out length %d", len(out))
	}
	for i, p := range perm {
		if out[i] != statuses[p] {
			t.Fatalf("out[%d] = %s, want statuses[%d]=%s", i, out[i], p, statuses[p])
		}
	}
}

// TestPublicCollectionsEmptyJSON 回归：所有公开集合必须序列化为 []，不能是 null。
func TestPublicCollectionsEmptyJSON(t *testing.T) {
	collections := map[string]any{
		"members": MemberViews(nil),
		"boards":  hydrateBoards(nil, nil, nil),
		"scores":  MemberScoresForLegacy(ScoresView{}, nil),
		"results": MemberResults(nil, nil),
	}
	for name, collection := range collections {
		data, err := json.Marshal(collection)
		if err != nil || string(data) != `[]` {
			t.Errorf("%s marshal = %s (%v), want []", name, data, err)
		}
	}

	payload, err := json.Marshal(RoundEndedPayload{
		Boards:  collections["boards"].([]MemberBoardView),
		Scores:  collections["scores"].([]MemberScoreView),
		Results: collections["results"].([]MemberResultView),
	})
	if err != nil {
		t.Fatalf("marshal round.ended: %v", err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatalf("unmarshal round.ended: %v", err)
	}
	for _, name := range []string{"boards", "scores", "results"} {
		if string(fields[name]) != `[]` {
			t.Errorf("round.ended %s = %s, want []", name, fields[name])
		}
	}
}

func TestPublicCollectionsOrderedBySeat(t *testing.T) {
	memberSeatByID := map[string]int32{
		"member-three": 3,
		"member-one":   1,
		"member-two":   2,
	}
	winner := "member-two"

	scores := MemberScoresForLegacy(ScoresView{Slot1: 4, Slot2: 5}, memberSeatByID)
	results := MemberResults(&winner, memberSeatByID)
	for i, wantSeat := range []int{1, 2, 3} {
		if scores[i].Seat != wantSeat || results[i].Seat != wantSeat {
			t.Fatalf("index %d seats = score:%d result:%d, want %d", i, scores[i].Seat, results[i].Seat, wantSeat)
		}
	}
	if scores[0].Score != 4 || scores[1].Score != 5 || scores[2].Score != 0 {
		t.Fatalf("scores = %#v, want legacy seats 1/2 plus zero-valued seat 3", scores)
	}
	if results[0].Result != MatchResultLoss || results[1].Result != MatchResultWin || results[2].Result != MatchResultLoss {
		t.Fatalf("results = %#v, want loss/win/loss", results)
	}
}
