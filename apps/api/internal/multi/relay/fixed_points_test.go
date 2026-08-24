package relay

import (
	"errors"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

func TestFixedPointsDelta(t *testing.T) {
	encounterID := "encounter-1"
	tests := []struct {
		name        string
		participant ParticipantOutcome
		want        int
	}{
		{name: "win", participant: ParticipantOutcome{EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: OutcomeWin}, want: 2},
		{name: "loss", participant: ParticipantOutcome{EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: OutcomeLoss}, want: 0},
		{name: "draw", participant: ParticipantOutcome{EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: OutcomeDraw}, want: 1},
		{name: "bye", participant: ParticipantOutcome{Assignment: AssignmentBye, Outcome: OutcomeBye}, want: 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := fixedPointsDelta(test.participant)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("delta = %d, want %d", got, test.want)
			}
		})
	}
}

func TestFixedPointsPolicyUsesPlannedStagesNotTargetWins(t *testing.T) {
	input := fixedPointsInput(4, 1, 3)
	input.Match.TargetWins = 1
	decision, err := (FixedPointsPolicy{}).Settle(input)
	if err != nil {
		t.Fatal(err)
	}
	if !decision.CreateNextStage || decision.Match != nil {
		t.Fatalf("stage 1 decision = %+v", decision)
	}
	if len(decision.NextPlayers) != 4 || decision.Players[0].ScoreAfter != 2 {
		t.Fatalf("stage 1 standings = %+v", decision.Standings)
	}

	input = fixedPointsInput(4, 3, 3)
	input.Match.TargetWins = 999
	input.States[0].Score = 4
	input.States[1].Score = 2
	decision, err = (FixedPointsPolicy{}).Settle(input)
	if err != nil {
		t.Fatal(err)
	}
	if decision.CreateNextStage || decision.Match == nil || !decision.Match.Ended {
		t.Fatalf("terminal decision = %+v", decision)
	}
	if decision.Match.WinnerMemberID == nil || *decision.Match.WinnerMemberID != "member-1" {
		t.Fatalf("winner = %v", decision.Match.WinnerMemberID)
	}
}

func TestFixedPointsRankingUsesCompetitionRanksWithoutTieBreak(t *testing.T) {
	tests := []struct {
		name       string
		scores     []int
		wantRanks  []int
		wantWinner string
	}{
		{name: "all tie", scores: []int{3, 3, 3, 3}, wantRanks: []int{1, 1, 1, 1}},
		{name: "partial ties", scores: []int{7, 7, 4, 2}, wantRanks: []int{1, 1, 3, 4}},
		{name: "unique leader", scores: []int{5, 3, 3, 0}, wantRanks: []int{1, 2, 2, 4}, wantWinner: "member-1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			states := fixedPointStates(test.scores)
			ranking, winner := FixedPointsRanking(states)
			if len(ranking) != len(test.wantRanks) {
				t.Fatalf("ranking length = %d", len(ranking))
			}
			for index, want := range test.wantRanks {
				if ranking[index].Rank != want {
					t.Fatalf("ranking[%d] = %+v, want rank %d", index, ranking[index], want)
				}
			}
			if test.wantWinner == "" {
				if winner != nil {
					t.Fatalf("winner = %s, want nil", *winner)
				}
			} else if winner == nil || *winner != test.wantWinner {
				t.Fatalf("winner = %v, want %s", winner, test.wantWinner)
			}
		})
	}
}

func TestFixedPointsPolicyRejectsTwoPlayers(t *testing.T) {
	input := fixedPointsInput(2, 1, 1)
	if _, err := (FixedPointsPolicy{}).Settle(input); !errors.Is(err, ErrInvalidStagePlan) {
		t.Fatalf("error = %v", err)
	}
}

func TestScoringPolicyRouterFailsClosedForUnknownRuleSet(t *testing.T) {
	router, err := NewScoringPolicyRouter(map[core.RuleSetRef]ScoringPolicy{
		FixedPointsRuleSet(): FixedPointsPolicy{},
	})
	if err != nil {
		t.Fatal(err)
	}
	input := fixedPointsInput(4, 1, 1)
	input.Match.RuleSet = core.RuleSetRef{Mode: core.ModeRelay, Key: RuleFixedPoints, Version: 2}
	if _, err := router.Settle(input); !errors.Is(err, ErrInvalidStagePlan) {
		t.Fatalf("error = %v", err)
	}
}

func fixedPointsInput(playerCount, stageIndex, maxStages int) SettlementInput {
	states := fixedPointStates(make([]int, playerCount))
	participants := make([]ParticipantOutcome, 0, playerCount)
	for index := 0; index < playerCount; index += 2 {
		encounterID := "encounter-" + states[index].Player.MemberID
		participants = append(participants,
			ParticipantOutcome{Player: states[index].Player, EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: OutcomeWin},
			ParticipantOutcome{Player: states[index+1].Player, EncounterID: &encounterID, Assignment: AssignmentPaired, Outcome: OutcomeLoss},
		)
	}
	return SettlementInput{
		Match:   MatchContext{MatchID: "match-1", RoomID: "room-1", RuleSet: FixedPointsRuleSet(), TargetWins: 1, MaxStages: maxStages},
		StageID: "stage-1", StageIndex: stageIndex, Participants: participants, States: states,
	}
}

func fixedPointStates(scores []int) []PlayerState {
	states := make([]PlayerState, 0, len(scores))
	for index, score := range scores {
		states = append(states, PlayerState{
			Player: PlayerSnapshot{MemberID: "member-" + string(rune('1'+index)), Seat: index + 1},
			Score:  score, LifeState: LifeStateHealthy, Status: "active",
		})
	}
	return states
}
