package multi

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

func TestColumnPermutationDeterministic(t *testing.T) {
	secret := []byte("test-projection-secret")
	a := ColumnPermutation(secret, "round-1", "member-a", "member-b", ProjectionSchemaVersion, 6)
	b := ColumnPermutation(secret, "round-1", "member-a", "member-b", ProjectionSchemaVersion, 6)
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
	secret := []byte("test-projection-secret")
	pa := ColumnPermutation(secret, "round-1", "member-a", "member-c", ProjectionSchemaVersion, 6)
	pb := ColumnPermutation(secret, "round-1", "member-b", "member-c", ProjectionSchemaVersion, 6)
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
	pRound2 := ColumnPermutation(secret, "round-2", "member-a", "member-c", ProjectionSchemaVersion, 6)
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

func TestColumnPermutationBindsSubjectSchemaAndSecret(t *testing.T) {
	secret := []byte("test-projection-secret")
	base := ColumnPermutation(secret, "round-1", "observer", "subject-a", ProjectionSchemaVersion, 8)
	variants := [][]int{
		ColumnPermutation(secret, "round-1", "observer", "subject-b", ProjectionSchemaVersion, 8),
		ColumnPermutation(secret, "round-1", "observer", "subject-a", "opponent-board-v2", 8),
		ColumnPermutation([]byte("another-secret"), "round-1", "observer", "subject-a", ProjectionSchemaVersion, 8),
	}
	for index, variant := range variants {
		if equalPermutation(base, variant) {
			t.Fatalf("variant %d reused permutation %v", index, base)
		}
	}
}

func equalPermutation(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestPermuteStatuses(t *testing.T) {
	perm := ColumnPermutation([]byte("test-projection-secret"), "r", "o", "s", ProjectionSchemaVersion, 6)
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

func TestMatchStartedV2PayloadNormalizesRuleSetRefV3(t *testing.T) {
	tests := []struct {
		name    string
		mode    string
		scoring string
		key     string
	}{
		{name: "race placement", mode: "race", scoring: "placement", key: "placement"},
		{name: "legacy relay", mode: "relay", scoring: "wins", key: "legacy_wins"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			payload, err := json.Marshal(map[string]any{"mode": test.mode, "scoringMode": test.scoring})
			if err != nil {
				t.Fatal(err)
			}
			projected, skip, err := ProjectEvent(context.Background(), nil, nil, repo.RoomEvent{
				Type: string(EventMatchStarted), Payload: payload,
			}, "room-1", repo.MultiMember{}, nil, nil)
			if err != nil || skip {
				t.Fatalf("project legacy match.started = skip:%v err:%v", skip, err)
			}
			got := projected.Payload.(MatchStartedPayload).RuleSetRef
			if got.Mode != MultiplayerMode(test.mode) || got.Key != test.key || got.Version != 1 {
				t.Fatalf("normalized RuleSetRef = %+v", got)
			}
			activeFields := projected.Payload.(MatchStartedPayload).ActiveFields
			if len(activeFields) != len(game.CharacterGuessFields) {
				t.Fatalf("normalized active fields = %d, want %d", len(activeFields), len(game.CharacterGuessFields))
			}
		})
	}
}

func TestRelayEventProjectionDropsAnswersFromActivePayloads(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"matchIndex":     0,
		"stageId":        "stage-1",
		"stageIndex":     1,
		"encounterId":    "encounter-1",
		"encounterIndex": 1,
		"status":         "playing",
		"members":        []map[string]any{},
		"answer": map[string]any{
			"id": "secret-answer",
		},
		"maxTurnsPerPlayer": 10,
		"maxSkipsPerPlayer": 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	projected, skip, err := ProjectEvent(context.Background(), nil, nil, repo.RoomEvent{
		Type: string(EventRelayEncounterStarted), Payload: payload,
	}, "room-1", repo.MultiMember{}, nil, nil)
	if err != nil || skip {
		t.Fatalf("project active relay event = skip:%v err:%v", skip, err)
	}
	data, err := json.Marshal(projected.Payload)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	if _, exists := fields["answer"]; exists {
		t.Fatalf("active relay event leaked answer: %s", data)
	}
}

func TestRelayEncounterEndedProjectionKeepsTerminalAnswer(t *testing.T) {
	payload, err := json.Marshal(RelayEncounterEndedPayload{
		Status: "ended",
		Answer: AnswerView{ID: "terminal-answer", Name: "Terminal"},
	})
	if err != nil {
		t.Fatal(err)
	}
	projected, skip, err := ProjectEvent(context.Background(), nil, nil, repo.RoomEvent{
		Type: string(EventRelayEncounterEnded), Payload: payload,
	}, "room-1", repo.MultiMember{}, nil, nil)
	if err != nil || skip {
		t.Fatalf("project terminal relay event = skip:%v err:%v", skip, err)
	}
	got := projected.Payload.(RelayEncounterEndedPayload)
	if got.Answer.ID != "terminal-answer" {
		t.Fatalf("terminal answer = %+v", got.Answer)
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

func TestPermuteFieldOrder(t *testing.T) {
	fields := []game.GuessField{
		{Key: game.FieldFirstAppearance},
		{Key: game.FieldReleaseYear},
		{Key: game.FieldSpecies},
	}
	got := PermuteFieldOrder(fields, []int{2, 0, 1})
	want := []game.GuessFieldKey{
		game.FieldSpecies,
		game.FieldFirstAppearance,
		game.FieldReleaseYear,
	}
	if !equalFieldKeys(got, want) {
		t.Fatalf("field order = %v, want %v", got, want)
	}
}

func equalFieldKeys(a, b []game.GuessFieldKey) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
