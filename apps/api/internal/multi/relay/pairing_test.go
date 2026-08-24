package relay_test

import (
	"encoding/json"
	"reflect"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/relay"
)

type sequenceRandom struct {
	values []int
	index  int
}

func (r *sequenceRandom) IntN(n int) int {
	value := r.values[r.index%len(r.values)] % n
	r.index++
	return value
}

func TestRandomPairingPolicyCoversEvenRosters(t *testing.T) {
	for _, playerCount := range []int{2, 4, 6, 8} {
		t.Run(string(rune('0'+playerCount)), func(t *testing.T) {
			active := playerSnapshots(playerCount)
			plan, err := (relay.RandomPairingPolicy{}).Plan(active, nil, &sequenceRandom{values: []int{1, 0, 3, 2}})
			if err != nil {
				t.Fatal(err)
			}
			if len(plan.Pairs) != playerCount/2 || plan.Bye != nil {
				t.Fatalf("pairs=%d bye=%v", len(plan.Pairs), plan.Bye)
			}
			assertPairingCoverage(t, plan, active)
		})
	}
}

func TestRandomPairingPolicyChoosesOneNonConsecutiveBye(t *testing.T) {
	for _, playerCount := range []int{3, 5, 7} {
		active := playerSnapshots(playerCount)
		previousBye := active[0].MemberID
		plan, err := (relay.RandomPairingPolicy{}).Plan(active, &previousBye, &sequenceRandom{values: []int{0, 2, 1}})
		if err != nil {
			t.Fatal(err)
		}
		if plan.Bye == nil || plan.Bye.MemberID == previousBye {
			t.Fatalf("playerCount=%d bye=%v previous=%s", playerCount, plan.Bye, previousBye)
		}
		assertPairingCoverage(t, plan, active)
	}
}

func TestPairingPlanJSONRoundTripIsStable(t *testing.T) {
	active := playerSnapshots(7)
	policy := relay.RandomPairingPolicy{}
	plan, err := policy.Plan(active, nil, &sequenceRandom{values: []int{4, 2, 1, 0}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var recovered relay.PairingPlan
	if err := json.Unmarshal(data, &recovered); err != nil {
		t.Fatal(err)
	}
	if err := recovered.Validate(); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(recovered, plan) {
		t.Fatalf("recovered=%+v want=%+v", recovered, plan)
	}
}

func TestRandomPairingPolicyRejectsUnstableRoster(t *testing.T) {
	active := []relay.PlayerSnapshot{{MemberID: "member-2", Seat: 2}, {MemberID: "member-1", Seat: 1}}
	if _, err := (relay.RandomPairingPolicy{}).Plan(active, nil, &sequenceRandom{values: []int{0}}); err == nil {
		t.Fatal("unstable roster was accepted")
	}
}

func playerSnapshots(count int) []relay.PlayerSnapshot {
	players := make([]relay.PlayerSnapshot, 0, count)
	for seat := 1; seat <= count; seat++ {
		players = append(players, relay.PlayerSnapshot{MemberID: "member-" + string(rune('0'+seat)), Seat: seat})
	}
	return players
}

func assertPairingCoverage(t *testing.T, plan relay.PairingPlan, active []relay.PlayerSnapshot) {
	t.Helper()
	if err := plan.Validate(); err != nil {
		t.Fatal(err)
	}
	seen := map[string]int{}
	for _, pair := range plan.Pairs {
		for _, player := range pair.Members {
			seen[player.MemberID]++
		}
	}
	if plan.Bye != nil {
		seen[plan.Bye.MemberID]++
	}
	for _, player := range active {
		if seen[player.MemberID] != 1 {
			t.Fatalf("member %s appears %d times", player.MemberID, seen[player.MemberID])
		}
	}
}
