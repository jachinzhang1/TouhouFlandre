package multi

import (
	"reflect"
	"testing"
)

func TestRacePlacementPoints(t *testing.T) {
	for players := 3; players <= 8; players++ {
		order := make([]string, players)
		for index := range order {
			order[index] = string(rune('a' + index))
		}
		points := RacePlacement(players, order)
		for index, memberID := range order {
			if got, want := points[memberID], players-index; got != want {
				t.Fatalf("N=%d rank=%d points=%d want %d", players, index+1, got, want)
			}
		}
	}
}

func TestRaceEliminationCandidates(t *testing.T) {
	players := []RaceParticipantScore{
		{MemberID: "a", Score: 5, BestRoundScore: 3, Status: "active"},
		{MemberID: "b", Score: 2, BestRoundScore: 2, Status: "active"},
		{MemberID: "c", Score: 2, BestRoundScore: 1, Status: "active"},
		{MemberID: "d", Score: 2, BestRoundScore: 1, Status: "active"},
	}
	if got := RaceEliminationCandidates(players, 4, 1); got != nil {
		t.Fatalf("eliminated before threshold: %v", got)
	}
	if got, want := RaceEliminationCandidates(players, 4, 2), []string{"c", "d"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("elimination=%v want %v", got, want)
	}
	for index := range players {
		players[index].Score = 0
		players[index].BestRoundScore = 0
	}
	if got := RaceEliminationCandidates(players, 4, 2); got != nil {
		t.Fatalf("all-player tie must not eliminate: %v", got)
	}
}

func TestRaceEliminationStartsAtFrozenRosterThresholdForN3To8(t *testing.T) {
	for rosterSize := 3; rosterSize <= 8; rosterSize++ {
		players := make([]RaceParticipantScore, rosterSize)
		for index := range players {
			players[index] = RaceParticipantScore{
				MemberID:       string(rune('a' + index)),
				Score:          rosterSize - index,
				BestRoundScore: rosterSize - index,
				Status:         "active",
			}
		}
		threshold := rosterSize / 2
		if got := RaceEliminationCandidates(players, rosterSize, threshold-1); got != nil {
			t.Fatalf("N=%d eliminated before round %d: %v", rosterSize, threshold, got)
		}
		want := []string{players[len(players)-1].MemberID}
		if got := RaceEliminationCandidates(players, rosterSize, threshold); !reflect.DeepEqual(got, want) {
			t.Fatalf("N=%d elimination=%v want %v", rosterSize, got, want)
		}
	}
}

func TestRaceEliminationIgnoresLeftPlayersAndCanEliminateAfterDeparture(t *testing.T) {
	players := []RaceParticipantScore{
		{MemberID: "a", Score: 5, BestRoundScore: 3, Status: "active"},
		{MemberID: "b", Score: 0, BestRoundScore: 0, Status: "left"},
		{MemberID: "c", Score: 1, BestRoundScore: 1, Status: "active"},
		{MemberID: "d", Score: 3, BestRoundScore: 2, Status: "active"},
	}
	if got, want := RaceEliminationCandidates(players, 4, 2), []string{"c"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("post-departure elimination=%v want %v", got, want)
	}
}

func TestRaceMatchTerminationAndSharedRanking(t *testing.T) {
	players := []RaceParticipantScore{
		{MemberID: "a", Seat: 1, Score: 8, Status: "active"},
		{MemberID: "b", Seat: 2, Score: 6, Status: "active"},
		{MemberID: "c", Seat: 3, Score: 8, Status: "eliminated"},
	}
	result := RaceMatchResultFor(players, 3, 2, 9)
	if !result.Ended || result.WinnerMemberID != nil {
		t.Fatalf("two-player lead should end with tied top draw: %+v", result)
	}
	ranking := RaceRanking(players)
	if got := []int{ranking[0].Rank, ranking[1].Rank, ranking[2].Rank}; !reflect.DeepEqual(got, []int{1, 1, 3}) {
		t.Fatalf("shared ranks=%v", got)
	}

	players[0].Score = 9
	result = RaceMatchResultFor(players, 3, 9, 9)
	if result.WinnerMemberID == nil || *result.WinnerMemberID != "a" {
		t.Fatalf("unique top winner=%+v", result)
	}
}

func TestRaceMatchTerminalConditions(t *testing.T) {
	oneActive := []RaceParticipantScore{
		{MemberID: "a", Score: 4, Status: "active"},
		{MemberID: "b", Score: 2, Status: "eliminated"},
	}
	if result := RaceMatchResultFor(oneActive, 3, 2, 9); !result.Ended || result.Reason != MatchEndReasonNormal || result.WinnerMemberID == nil || *result.WinnerMemberID != "a" {
		t.Fatalf("one-active result=%+v", result)
	}
	twoClose := []RaceParticipantScore{
		{MemberID: "a", Score: 4, Status: "active"},
		{MemberID: "b", Score: 3, Status: "active"},
	}
	if result := RaceMatchResultFor(twoClose, 3, 2, 9); result.Ended {
		t.Fatalf("one-point lead ended early: %+v", result)
	}
	twoClose[0].Score = 5
	if result := RaceMatchResultFor(twoClose, 3, 2, 9); !result.Ended || result.Reason != MatchEndReasonNormal {
		t.Fatalf("two-point lead did not end: %+v", result)
	}
	threeActive := append(twoClose, RaceParticipantScore{MemberID: "c", Score: 1, Status: "active"})
	if result := RaceMatchResultFor(threeActive, 3, 9, 9); !result.Ended || result.Reason != MatchEndReasonRoundCap {
		t.Fatalf("round cap result=%+v", result)
	}
}
