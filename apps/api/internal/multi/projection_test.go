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

// TestHydrateBoardsEmptySlots 回归：空槽必须是非 nil 空切片（JSON 序列化为 []，前端按数组消费）。
func TestHydrateBoardsEmptySlots(t *testing.T) {
	boards := hydrateBoards(nil, nil, nil)
	if boards.Slot1 == nil || len(boards.Slot1) != 0 {
		t.Fatalf("Slot1 = %#v, want 非 nil 空切片", boards.Slot1)
	}
	if boards.Slot2 == nil || len(boards.Slot2) != 0 {
		t.Fatalf("Slot2 = %#v, want 非 nil 空切片", boards.Slot2)
	}
	if data, err := json.Marshal(boards); err != nil || string(data) != `{"slot1":[],"slot2":[]}` {
		t.Fatalf("marshal = %s (%v), want {\"slot1\":[],\"slot2\":[]}", data, err)
	}
}
