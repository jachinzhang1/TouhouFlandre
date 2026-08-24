package relay

import (
	"fmt"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

func TestEliminationPlayerTransitions(t *testing.T) {
	encounterID := "encounter-1"
	tests := []struct {
		name           string
		state          PlayerState
		participant    ParticipantOutcome
		stage          int
		wantScore      int
		wantDelta      int
		wantLife       LifeState
		wantTransition LifeTransition
		wantEliminated bool
	}{
		{name: "win is capped at ten", state: eliminationState(1, 10, LifeStateHealthy, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeWin), stage: 1, wantScore: 10, wantLife: LifeStateHealthy, wantTransition: LifeTransitionNone},
		{name: "loss to exactly zero stays healthy", state: eliminationState(1, 3, LifeStateHealthy, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeLoss), stage: 3, wantScore: 0, wantDelta: -3, wantLife: LifeStateHealthy, wantTransition: LifeTransitionNone},
		{name: "first negative enters near death and clamps", state: eliminationState(1, 2, LifeStateHealthy, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeLoss), stage: 3, wantScore: 0, wantDelta: -2, wantLife: LifeStateNearDeath, wantTransition: LifeTransitionEnteredNearDeath},
		{name: "near death win has no effect", state: eliminationState(1, 0, LifeStateNearDeath, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeWin), stage: 4, wantScore: 0, wantLife: LifeStateNearDeath, wantTransition: LifeTransitionNone},
		{name: "stage one draw does not eliminate near death", state: eliminationState(1, 0, LifeStateNearDeath, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeDraw), stage: 1, wantScore: 0, wantLife: LifeStateNearDeath, wantTransition: LifeTransitionNone},
		{name: "next negative eliminates near death", state: eliminationState(1, 0, LifeStateNearDeath, "active", nil), participant: pairedOutcome(1, &encounterID, OutcomeLoss), stage: 4, wantScore: -4, wantDelta: -4, wantLife: LifeStateNearDeath, wantTransition: LifeTransitionEliminated, wantEliminated: true},
		{name: "healthy bye is frozen", state: eliminationState(1, 7, LifeStateHealthy, "active", nil), participant: byeOutcome(1), stage: 9, wantScore: 7, wantLife: LifeStateHealthy, wantTransition: LifeTransitionNone},
		{name: "near death bye is frozen", state: eliminationState(1, 0, LifeStateNearDeath, "active", nil), participant: byeOutcome(1), stage: 9, wantScore: 0, wantLife: LifeStateNearDeath, wantTransition: LifeTransitionNone},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			delta, err := eliminationDelta(test.participant, test.stage)
			if err != nil {
				t.Fatal(err)
			}
			got := settleEliminationPlayer(test.state, test.participant, test.stage, delta)
			if got.ScoreAfter != test.wantScore || got.ScoreDelta != test.wantDelta || got.LifeAfter != test.wantLife || got.LifeTransition != test.wantTransition {
				t.Fatalf("settlement = %+v", got)
			}
			if (got.EliminatedStage != nil) != test.wantEliminated {
				t.Fatalf("eliminatedStage = %v", got.EliminatedStage)
			}
			if got.EliminatedStage != nil && *got.EliminatedStage != test.stage {
				t.Fatalf("eliminatedStage = %d, want %d", *got.EliminatedStage, test.stage)
			}
		})
	}
}

func TestEliminationDrawPenaltyUsesFloor(t *testing.T) {
	encounterID := "encounter-1"
	participant := pairedOutcome(1, &encounterID, OutcomeDraw)
	for stage, want := range map[int]int{1: 0, 2: -1, 3: -1, 4: -2, 7: -3} {
		got, err := eliminationDelta(participant, stage)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("stage %d delta = %d, want %d", stage, got, want)
		}
	}
}

func TestEliminationPolicyHandlesZeroOneManyAndAllEliminations(t *testing.T) {
	tests := []struct {
		name           string
		input          SettlementInput
		wantEliminated int
		wantActive     int
		wantNext       bool
		wantWinner     string
	}{
		{name: "zero", input: eliminationInput(1, activeEliminationStates(4, 10), []PlayerOutcome{OutcomeWin, OutcomeLoss, OutcomeWin, OutcomeLoss}), wantActive: 4, wantNext: true},
		{name: "one", input: eliminationInput(2, []PlayerState{
			eliminationState(1, 10, LifeStateHealthy, "active", nil), eliminationState(2, 0, LifeStateNearDeath, "active", nil),
			eliminationState(3, 10, LifeStateHealthy, "active", nil), eliminationState(4, 10, LifeStateHealthy, "active", nil),
		}, []PlayerOutcome{OutcomeWin, OutcomeLoss, OutcomeWin, OutcomeLoss}), wantEliminated: 1, wantActive: 3, wantNext: true},
		{name: "many", input: eliminationInput(2, []PlayerState{
			eliminationState(1, 10, LifeStateHealthy, "active", nil), eliminationState(2, 0, LifeStateNearDeath, "active", nil),
			eliminationState(3, 10, LifeStateHealthy, "active", nil), eliminationState(4, 0, LifeStateNearDeath, "active", nil),
		}, []PlayerOutcome{OutcomeWin, OutcomeLoss, OutcomeWin, OutcomeLoss}), wantEliminated: 2, wantActive: 2, wantNext: true},
		{name: "all", input: eliminationInput(2, nearDeathEliminationStates(4), []PlayerOutcome{OutcomeDraw, OutcomeDraw, OutcomeDraw, OutcomeDraw}), wantEliminated: 4},
		{name: "unique survivor", input: eliminationInput(3, []PlayerState{
			eliminationState(1, 10, LifeStateHealthy, "active", nil), eliminationState(2, 0, LifeStateNearDeath, "active", nil),
			eliminationState(3, -1, LifeStateNearDeath, "eliminated", intPointer(1)), eliminationState(4, -1, LifeStateNearDeath, "eliminated", intPointer(1)),
		}, []PlayerOutcome{OutcomeWin, OutcomeLoss}), wantEliminated: 1, wantActive: 1, wantWinner: "member-1"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			decision, err := (EliminationPolicy{}).Settle(test.input)
			if err != nil {
				t.Fatal(err)
			}
			if len(decision.EliminatedMemberIDs) != test.wantEliminated || decision.CreateNextStage != test.wantNext {
				t.Fatalf("decision = %+v", decision)
			}
			active := 0
			for _, standing := range decision.Standings {
				if standing.Status == "active" {
					active++
				}
			}
			if active != test.wantActive {
				t.Fatalf("active = %d, want %d", active, test.wantActive)
			}
			if test.wantNext && len(decision.NextPlayers) != test.wantActive {
				t.Fatalf("next players = %d, want %d", len(decision.NextPlayers), test.wantActive)
			}
			if !test.wantNext {
				if decision.Match == nil || !decision.Match.Ended {
					t.Fatalf("terminal decision = %+v", decision.Match)
				}
				if test.wantWinner == "" && decision.Match.WinnerMemberID != nil {
					t.Fatalf("winner = %v, want nil", decision.Match.WinnerMemberID)
				}
				if test.wantWinner != "" && (decision.Match.WinnerMemberID == nil || *decision.Match.WinnerMemberID != test.wantWinner) {
					t.Fatalf("winner = %v, want %s", decision.Match.WinnerMemberID, test.wantWinner)
				}
			}
		})
	}
}

func TestEliminationPolicySupportsFrozenRosterSizes(t *testing.T) {
	for _, count := range []int{4, 6, 8} {
		t.Run(fmt.Sprintf("%d_players", count), func(t *testing.T) {
			outcomes := make([]PlayerOutcome, count)
			for index := range outcomes {
				if index%2 == 0 {
					outcomes[index] = OutcomeWin
				} else {
					outcomes[index] = OutcomeLoss
				}
			}

			decision, err := (EliminationPolicy{}).Settle(eliminationInput(1, activeEliminationStates(count, EliminationInitialScore), outcomes))
			if err != nil {
				t.Fatal(err)
			}
			if !decision.CreateNextStage || len(decision.NextPlayers) != count || len(decision.Standings) != count || len(decision.EliminatedMemberIDs) != 0 {
				t.Fatalf("decision = %+v", decision)
			}
		})
	}
}

func TestEliminationPolicyContinuesWithTwoActiveAndIgnoresRoundCap(t *testing.T) {
	states := []PlayerState{
		eliminationState(1, 10, LifeStateHealthy, "active", nil), eliminationState(2, 10, LifeStateHealthy, "active", nil),
		eliminationState(3, -1, LifeStateNearDeath, "eliminated", intPointer(1)), eliminationState(4, -1, LifeStateNearDeath, "eliminated", intPointer(1)),
	}
	input := eliminationInput(20, states, []PlayerOutcome{OutcomeWin, OutcomeLoss})
	input.Match.MaxStages = 1
	input.Match.TargetWins = 1
	decision, err := (EliminationPolicy{}).Settle(input)
	if err != nil {
		t.Fatal(err)
	}
	if !decision.CreateNextStage || decision.Match != nil || len(decision.NextPlayers) != 2 {
		t.Fatalf("decision = %+v", decision)
	}
}

func TestEliminationPolicyKeepsOddRosterByeUnchanged(t *testing.T) {
	states := []PlayerState{
		eliminationState(1, 10, LifeStateHealthy, "active", nil), eliminationState(2, 10, LifeStateHealthy, "active", nil),
		eliminationState(3, 0, LifeStateNearDeath, "active", nil), eliminationState(4, -1, LifeStateNearDeath, "eliminated", intPointer(1)),
	}
	input := eliminationInput(2, states, []PlayerOutcome{OutcomeWin, OutcomeLoss, OutcomeBye})
	decision, err := (EliminationPolicy{}).Settle(input)
	if err != nil {
		t.Fatal(err)
	}
	bye := decision.Players[2]
	if bye.Assignment != AssignmentBye || bye.ScoreBefore != 0 || bye.ScoreAfter != 0 || bye.LifeBefore != LifeStateNearDeath || bye.LifeAfter != LifeStateNearDeath || bye.LifeTransition != LifeTransitionNone {
		t.Fatalf("bye settlement = %+v", bye)
	}
}

func TestEliminationRankingUsesOnlySurvivedStages(t *testing.T) {
	states := []PlayerState{
		eliminationState(1, 0, LifeStateNearDeath, "active", nil),
		eliminationState(2, -100, LifeStateNearDeath, "eliminated", intPointer(4)),
		eliminationState(3, -1, LifeStateNearDeath, "eliminated", intPointer(4)),
		eliminationState(4, -1, LifeStateNearDeath, "eliminated", intPointer(2)),
	}
	ranking, winner, err := EliminationRanking(states, 4)
	if err != nil {
		t.Fatal(err)
	}
	wantRanks := []int{1, 2, 2, 4}
	wantSurvived := []int{4, 3, 3, 1}
	for index := range ranking {
		if ranking[index].Rank != wantRanks[index] || ranking[index].SurvivedStages == nil || *ranking[index].SurvivedStages != wantSurvived[index] {
			t.Fatalf("ranking[%d] = %+v", index, ranking[index])
		}
	}
	if winner == nil || *winner != "member-1" {
		t.Fatalf("winner = %v", winner)
	}
}

func TestEliminationRankingAllowsAllPlayersTiedFirstWithoutWinner(t *testing.T) {
	states := nearDeathEliminationStates(4)
	for index := range states {
		states[index].Status = "eliminated"
		states[index].Score = -(index + 1)
		states[index].EliminatedStage = intPointer(5)
	}
	ranking, winner, err := EliminationRanking(states, 5)
	if err != nil {
		t.Fatal(err)
	}
	if winner != nil {
		t.Fatalf("winner = %v", winner)
	}
	for _, entry := range ranking {
		if entry.Rank != 1 || entry.SurvivedStages == nil || *entry.SurvivedStages != 4 {
			t.Fatalf("ranking = %+v", ranking)
		}
	}
}

func TestInitialScoreForRelayRuleSets(t *testing.T) {
	tests := []struct {
		ref  core.RuleSetRef
		want int
	}{
		{ref: LegacyRuleSet(), want: 0},
		{ref: FixedPointsRuleSet(), want: 0},
		{ref: EliminationRuleSet(), want: EliminationInitialScore},
	}
	for _, test := range tests {
		score, err := InitialScoreForRuleSet(test.ref)
		if err != nil || score != test.want {
			t.Fatalf("%s score=%d error=%v", test.ref, score, err)
		}
	}
}

func eliminationInput(stage int, states []PlayerState, outcomes []PlayerOutcome) SettlementInput {
	active := make([]PlayerState, 0, len(states))
	for _, state := range states {
		if state.Status == "active" {
			active = append(active, state)
		}
	}
	participants := make([]ParticipantOutcome, 0, len(active))
	paired := len(active)
	if paired%2 == 1 {
		paired--
	}
	for index := 0; index < paired; index += 2 {
		encounterID := fmt.Sprintf("encounter-%d", index/2+1)
		participants = append(participants,
			pairedOutcome(active[index].Player.Seat, &encounterID, outcomes[index]),
			pairedOutcome(active[index+1].Player.Seat, &encounterID, outcomes[index+1]),
		)
	}
	if len(active)%2 == 1 {
		participants = append(participants, byeOutcome(active[len(active)-1].Player.Seat))
	}
	return SettlementInput{
		Match:   MatchContext{MatchID: "match-1", RoomID: "room-1", RuleSet: EliminationRuleSet(), MaxStages: 1},
		StageID: "stage-1", StageIndex: stage, Participants: participants, States: states,
	}
}

func activeEliminationStates(count, score int) []PlayerState {
	states := make([]PlayerState, 0, count)
	for seat := 1; seat <= count; seat++ {
		states = append(states, eliminationState(seat, score, LifeStateHealthy, "active", nil))
	}
	return states
}

func nearDeathEliminationStates(count int) []PlayerState {
	states := make([]PlayerState, 0, count)
	for seat := 1; seat <= count; seat++ {
		states = append(states, eliminationState(seat, 0, LifeStateNearDeath, "active", nil))
	}
	return states
}

func eliminationState(seat, score int, life LifeState, status string, eliminatedStage *int) PlayerState {
	return PlayerState{
		Player: PlayerSnapshot{MemberID: fmt.Sprintf("member-%d", seat), Seat: seat},
		Score:  score, LifeState: life, Status: status, EliminatedStage: eliminatedStage,
	}
}

func pairedOutcome(seat int, encounterID *string, outcome PlayerOutcome) ParticipantOutcome {
	return ParticipantOutcome{
		Player:      PlayerSnapshot{MemberID: fmt.Sprintf("member-%d", seat), Seat: seat},
		EncounterID: encounterID, Assignment: AssignmentPaired, Outcome: outcome,
	}
}

func byeOutcome(seat int) ParticipantOutcome {
	return ParticipantOutcome{Player: PlayerSnapshot{MemberID: fmt.Sprintf("member-%d", seat), Seat: seat}, Assignment: AssignmentBye, Outcome: OutcomeBye}
}

func intPointer(value int) *int { return &value }
