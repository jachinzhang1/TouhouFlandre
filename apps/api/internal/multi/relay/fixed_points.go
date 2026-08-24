package relay

import (
	"fmt"
	"sort"
)

const (
	FixedPointsWin  = 2
	FixedPointsDraw = 1
	FixedPointsLoss = 0
	FixedPointsBye  = 0
)

type FixedPointsPolicy struct{}

func (FixedPointsPolicy) Settle(input SettlementInput) (SettlementDecision, error) {
	if input.Match.RuleSet != FixedPointsRuleSet() || !fixedPointsRosterSize(len(input.States)) ||
		len(input.Participants) != len(input.States) || input.Match.MaxStages < 1 ||
		input.StageIndex < 1 || input.StageIndex > input.Match.MaxStages || input.ForcedMatchEnd != nil {
		return SettlementDecision{}, fmt.Errorf("%w: invalid fixed-points input", ErrInvalidStagePlan)
	}

	stateByMember := make(map[string]PlayerState, len(input.States))
	for _, state := range input.States {
		if state.Player.MemberID == "" || state.Player.Seat < 1 || state.Status != "active" ||
			state.LifeState != LifeStateHealthy || state.EliminatedStage != nil {
			return SettlementDecision{}, fmt.Errorf("%w: invalid fixed-points player state", ErrInvalidStagePlan)
		}
		if _, exists := stateByMember[state.Player.MemberID]; exists {
			return SettlementDecision{}, fmt.Errorf("%w: duplicate fixed-points player state", ErrInvalidStagePlan)
		}
		stateByMember[state.Player.MemberID] = state
	}

	decision := SettlementDecision{
		Players:   make([]PlayerSettlement, 0, len(input.Participants)),
		Standings: make([]PlayerState, 0, len(input.States)),
	}
	for _, participant := range input.Participants {
		state, ok := stateByMember[participant.Player.MemberID]
		if !ok || state.Player != participant.Player {
			return SettlementDecision{}, fmt.Errorf("%w: missing fixed-points player state", ErrInvalidStagePlan)
		}
		delta, err := fixedPointsDelta(participant)
		if err != nil {
			return SettlementDecision{}, err
		}
		after := state.Score + delta
		decision.Players = append(decision.Players, PlayerSettlement{
			Player: participant.Player, EncounterID: participant.EncounterID,
			Assignment: participant.Assignment, Outcome: participant.Outcome,
			ScoreBefore: state.Score, ScoreDelta: delta, ScoreAfter: after,
			LifeBefore: state.LifeState, LifeAfter: state.LifeState, LifeTransition: LifeTransitionNone,
		})
		state.Score = after
		decision.Standings = append(decision.Standings, state)
		delete(stateByMember, participant.Player.MemberID)
	}
	if len(stateByMember) != 0 {
		return SettlementDecision{}, fmt.Errorf("%w: fixed-points settlement omitted player state", ErrInvalidStagePlan)
	}
	sort.Slice(decision.Players, func(i, j int) bool { return playerLess(decision.Players[i].Player, decision.Players[j].Player) })
	sort.Slice(decision.Standings, func(i, j int) bool { return playerLess(decision.Standings[i].Player, decision.Standings[j].Player) })

	if input.StageIndex < input.Match.MaxStages {
		decision.CreateNextStage = true
		decision.NextPlayers = make([]PlayerSnapshot, 0, len(decision.Standings))
		for _, standing := range decision.Standings {
			decision.NextPlayers = append(decision.NextPlayers, standing.Player)
		}
		return decision, nil
	}

	ranking, winner := FixedPointsRanking(decision.Standings)
	decision.Match = &MatchDecision{Ended: true, WinnerMemberID: winner, Reason: "normal", Ranking: ranking}
	return decision, nil
}

func FixedPointsRanking(states []PlayerState) ([]RankingEntry, *string) {
	ordered := append([]PlayerState(nil), states...)
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].Score != ordered[j].Score {
			return ordered[i].Score > ordered[j].Score
		}
		return playerLess(ordered[i].Player, ordered[j].Player)
	})
	ranking := make([]RankingEntry, 0, len(ordered))
	for index, state := range ordered {
		rank := index + 1
		if index > 0 && state.Score == ordered[index-1].Score {
			rank = ranking[index-1].Rank
		}
		ranking = append(ranking, RankingEntry{
			Player: state.Player, Rank: rank, Score: state.Score, Status: state.Status,
			LifeState: state.LifeState, EliminatedStage: state.EliminatedStage,
		})
	}
	if len(ranking) == 0 || (len(ranking) > 1 && ranking[1].Rank == 1) {
		return ranking, nil
	}
	winner := ranking[0].Player.MemberID
	return ranking, &winner
}

func fixedPointsDelta(participant ParticipantOutcome) (int, error) {
	if participant.Assignment == AssignmentBye {
		if participant.EncounterID != nil || participant.Outcome != OutcomeBye {
			return 0, fmt.Errorf("%w: invalid fixed-points bye outcome", ErrInvalidStagePlan)
		}
		return FixedPointsBye, nil
	}
	if participant.Assignment != AssignmentPaired || participant.EncounterID == nil {
		return 0, fmt.Errorf("%w: invalid fixed-points assignment", ErrInvalidStagePlan)
	}
	switch participant.Outcome {
	case OutcomeWin:
		return FixedPointsWin, nil
	case OutcomeDraw:
		return FixedPointsDraw, nil
	case OutcomeLoss:
		return FixedPointsLoss, nil
	default:
		return 0, fmt.Errorf("%w: invalid fixed-points outcome", ErrInvalidStagePlan)
	}
}

func fixedPointsRosterSize(size int) bool {
	return size == 4 || size == 6 || size == 8
}

func playerLess(left, right PlayerSnapshot) bool {
	if left.Seat != right.Seat {
		return left.Seat < right.Seat
	}
	return left.MemberID < right.MemberID
}
