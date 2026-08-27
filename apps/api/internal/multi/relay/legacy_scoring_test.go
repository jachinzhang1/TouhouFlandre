package relay

import "testing"

func TestLegacyWinsPolicyPublishesTerminalRanking(t *testing.T) {
	players := []PlayerState{
		{Player: PlayerSnapshot{MemberID: "one", Seat: 1}, Status: "active", LifeState: LifeStateHealthy},
		{Player: PlayerSnapshot{MemberID: "two", Seat: 2}, Status: "active", LifeState: LifeStateHealthy},
	}
	decision, err := (LegacyWinsPolicy{}).Settle(SettlementInput{
		Match:      MatchContext{RuleSet: LegacyRuleSet(), TargetWins: 1, MaxStages: 1},
		StageIndex: 1,
		Participants: []ParticipantOutcome{
			{Player: players[0].Player, Assignment: AssignmentPaired, Outcome: OutcomeWin},
			{Player: players[1].Player, Assignment: AssignmentPaired, Outcome: OutcomeLoss},
		},
		States: players,
	})
	if err != nil {
		t.Fatal(err)
	}
	if decision.Match == nil || !decision.Match.Ended || len(decision.Match.Ranking) != 2 {
		t.Fatalf("terminal decision = %+v", decision.Match)
	}
	if first, second := decision.Match.Ranking[0], decision.Match.Ranking[1]; first.Player.MemberID != "one" || first.Rank != 1 || first.Score != 1 ||
		second.Player.MemberID != "two" || second.Rank != 2 || second.Score != 0 {
		t.Fatalf("terminal ranking = %+v", decision.Match.Ranking)
	}
}

func TestLegacyWinsPolicyForcedDrawUsesSharedFirstRank(t *testing.T) {
	players := []PlayerState{
		{Player: PlayerSnapshot{MemberID: "one", Seat: 1}, Status: "active", LifeState: LifeStateHealthy},
		{Player: PlayerSnapshot{MemberID: "two", Seat: 2}, Status: "active", LifeState: LifeStateHealthy},
	}
	decision, err := (LegacyWinsPolicy{}).Settle(SettlementInput{
		Match:      MatchContext{RuleSet: LegacyRuleSet(), TargetWins: 2, MaxStages: 3},
		StageIndex: 1,
		Participants: []ParticipantOutcome{
			{Player: players[0].Player, Assignment: AssignmentPaired, Outcome: OutcomeDraw},
			{Player: players[1].Player, Assignment: AssignmentPaired, Outcome: OutcomeDraw},
		},
		States:         players,
		ForcedMatchEnd: &ForcedMatchEnd{Reason: "server_restart"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if decision.Match == nil || len(decision.Match.Ranking) != 2 ||
		decision.Match.Ranking[0].Rank != 1 || decision.Match.Ranking[1].Rank != 1 {
		t.Fatalf("forced draw ranking = %+v", decision.Match)
	}
}
