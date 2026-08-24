package relay

import (
	"fmt"
	"sort"
)

const (
	EliminationInitialScore = 10
	EliminationMaximumScore = 10
	EliminationWinScore     = 1
)

type EliminationPolicy struct{}

func (EliminationPolicy) Settle(input SettlementInput) (SettlementDecision, error) {
	if input.Match.RuleSet != EliminationRuleSet() || !eliminationRosterSize(len(input.States)) ||
		input.StageIndex < 1 || input.ForcedMatchEnd != nil {
		return SettlementDecision{}, fmt.Errorf("%w: invalid elimination input", ErrInvalidStagePlan)
	}

	stateByMember := make(map[string]PlayerState, len(input.States))
	activeCount := 0
	for _, state := range input.States {
		if err := validateEliminationState(state, input.StageIndex); err != nil {
			return SettlementDecision{}, err
		}
		if _, exists := stateByMember[state.Player.MemberID]; exists {
			return SettlementDecision{}, fmt.Errorf("%w: duplicate elimination player state", ErrInvalidStagePlan)
		}
		stateByMember[state.Player.MemberID] = state
		if state.Status == "active" {
			activeCount++
		}
	}
	if activeCount < 2 || len(input.Participants) != activeCount {
		return SettlementDecision{}, fmt.Errorf("%w: elimination participants do not match active players", ErrInvalidStagePlan)
	}

	decision := SettlementDecision{
		Players:   make([]PlayerSettlement, 0, len(input.Participants)),
		Standings: make([]PlayerState, 0, len(input.States)),
	}
	settled := make(map[string]struct{}, len(input.Participants))
	for _, participant := range input.Participants {
		state, ok := stateByMember[participant.Player.MemberID]
		if !ok || state.Player != participant.Player || state.Status != "active" {
			return SettlementDecision{}, fmt.Errorf("%w: invalid elimination participant", ErrInvalidStagePlan)
		}
		if _, duplicate := settled[participant.Player.MemberID]; duplicate {
			return SettlementDecision{}, fmt.Errorf("%w: duplicate elimination participant", ErrInvalidStagePlan)
		}
		ruleDelta, err := eliminationDelta(participant, input.StageIndex)
		if err != nil {
			return SettlementDecision{}, err
		}
		settlement := settleEliminationPlayer(state, participant, input.StageIndex, ruleDelta)
		decision.Players = append(decision.Players, settlement)
		state.Score = settlement.ScoreAfter
		state.LifeState = settlement.LifeAfter
		state.EliminatedStage = settlement.EliminatedStage
		if settlement.LifeTransition == LifeTransitionEliminated {
			state.Status = "eliminated"
			decision.EliminatedMemberIDs = append(decision.EliminatedMemberIDs, state.Player.MemberID)
		}
		stateByMember[state.Player.MemberID] = state
		settled[state.Player.MemberID] = struct{}{}
	}
	if len(settled) != activeCount {
		return SettlementDecision{}, fmt.Errorf("%w: elimination settlement omitted an active player", ErrInvalidStagePlan)
	}

	for _, state := range stateByMember {
		decision.Standings = append(decision.Standings, state)
	}
	sort.Slice(decision.Players, func(i, j int) bool { return playerLess(decision.Players[i].Player, decision.Players[j].Player) })
	sort.Slice(decision.Standings, func(i, j int) bool { return playerLess(decision.Standings[i].Player, decision.Standings[j].Player) })
	sort.Slice(decision.EliminatedMemberIDs, func(i, j int) bool {
		return stateByMember[decision.EliminatedMemberIDs[i]].Player.Seat < stateByMember[decision.EliminatedMemberIDs[j]].Player.Seat
	})

	active := make([]PlayerSnapshot, 0, len(decision.Standings))
	for _, standing := range decision.Standings {
		if standing.Status == "active" {
			active = append(active, standing.Player)
		}
	}
	if len(active) > 1 {
		decision.CreateNextStage = true
		decision.NextPlayers = active
		return decision, nil
	}

	ranking, winner, err := EliminationRanking(decision.Standings, input.StageIndex)
	if err != nil {
		return SettlementDecision{}, err
	}
	decision.Match = &MatchDecision{Ended: true, WinnerMemberID: winner, Reason: "normal", Ranking: ranking}
	return decision, nil
}

func eliminationDelta(participant ParticipantOutcome, stageIndex int) (int, error) {
	if participant.Assignment == AssignmentBye {
		if participant.EncounterID != nil || participant.Outcome != OutcomeBye {
			return 0, fmt.Errorf("%w: invalid elimination bye outcome", ErrInvalidStagePlan)
		}
		return 0, nil
	}
	if participant.Assignment != AssignmentPaired || participant.EncounterID == nil {
		return 0, fmt.Errorf("%w: invalid elimination assignment", ErrInvalidStagePlan)
	}
	switch participant.Outcome {
	case OutcomeWin:
		return EliminationWinScore, nil
	case OutcomeLoss:
		return -stageIndex, nil
	case OutcomeDraw:
		return -(stageIndex / 2), nil
	default:
		return 0, fmt.Errorf("%w: invalid elimination outcome", ErrInvalidStagePlan)
	}
}

func settleEliminationPlayer(state PlayerState, participant ParticipantOutcome, stageIndex, ruleDelta int) PlayerSettlement {
	after := state.Score + ruleDelta
	transition := LifeTransitionNone
	lifeAfter := state.LifeState
	var eliminatedStage *int

	if participant.Assignment == AssignmentBye {
		after = state.Score
	} else if state.LifeState == LifeStateNearDeath {
		if ruleDelta > 0 {
			after = state.Score
		} else if ruleDelta < 0 {
			transition = LifeTransitionEliminated
			stage := stageIndex
			eliminatedStage = &stage
		}
	} else if after < 0 {
		after = 0
		lifeAfter = LifeStateNearDeath
		transition = LifeTransitionEnteredNearDeath
	} else if after > EliminationMaximumScore {
		after = EliminationMaximumScore
	}

	return PlayerSettlement{
		Player: participant.Player, EncounterID: participant.EncounterID,
		Assignment: participant.Assignment, Outcome: participant.Outcome,
		ScoreBefore: state.Score, ScoreDelta: after - state.Score, ScoreAfter: after,
		LifeBefore: state.LifeState, LifeAfter: lifeAfter, LifeTransition: transition,
		EliminatedStage: eliminatedStage,
	}
}

func EliminationRanking(states []PlayerState, completedStages int) ([]RankingEntry, *string, error) {
	if completedStages < 1 || len(states) == 0 {
		return nil, nil, fmt.Errorf("%w: invalid elimination ranking input", ErrInvalidStagePlan)
	}
	type rankedState struct {
		state    PlayerState
		survived int
	}
	ordered := make([]rankedState, 0, len(states))
	var survivor *string
	survivorCount := 0
	for _, state := range states {
		survived := completedStages
		switch state.Status {
		case "active":
			if state.EliminatedStage != nil {
				return nil, nil, fmt.Errorf("%w: active elimination ranking state is eliminated", ErrInvalidStagePlan)
			}
			value := state.Player.MemberID
			survivor = &value
			survivorCount++
		case "eliminated":
			if state.EliminatedStage == nil || *state.EliminatedStage < 1 || *state.EliminatedStage > completedStages {
				return nil, nil, fmt.Errorf("%w: invalid eliminated stage in ranking", ErrInvalidStagePlan)
			}
			survived = *state.EliminatedStage - 1
		default:
			return nil, nil, fmt.Errorf("%w: unsupported elimination ranking status", ErrInvalidStagePlan)
		}
		ordered = append(ordered, rankedState{state: state, survived: survived})
	}
	sort.Slice(ordered, func(i, j int) bool {
		if ordered[i].survived != ordered[j].survived {
			return ordered[i].survived > ordered[j].survived
		}
		return playerLess(ordered[i].state.Player, ordered[j].state.Player)
	})
	ranking := make([]RankingEntry, 0, len(ordered))
	for index, entry := range ordered {
		rank := index + 1
		if index > 0 && entry.survived == ordered[index-1].survived {
			rank = ranking[index-1].Rank
		}
		survived := entry.survived
		ranking = append(ranking, RankingEntry{
			Player: entry.state.Player, Rank: rank, Score: entry.state.Score, Status: entry.state.Status,
			LifeState: entry.state.LifeState, EliminatedStage: entry.state.EliminatedStage, SurvivedStages: &survived,
		})
	}
	if survivorCount != 1 {
		return ranking, nil, nil
	}
	return ranking, survivor, nil
}

func validateEliminationState(state PlayerState, stageIndex int) error {
	if state.Player.MemberID == "" || state.Player.Seat < 1 || state.Player.Seat > 8 {
		return fmt.Errorf("%w: invalid elimination player identity", ErrInvalidStagePlan)
	}
	switch state.Status {
	case "active":
		if state.EliminatedStage != nil || state.Score > EliminationMaximumScore {
			return fmt.Errorf("%w: invalid active elimination state", ErrInvalidStagePlan)
		}
		if state.LifeState == LifeStateHealthy && state.Score < 0 {
			return fmt.Errorf("%w: healthy elimination score is negative", ErrInvalidStagePlan)
		}
		if state.LifeState == LifeStateNearDeath && state.Score != 0 {
			return fmt.Errorf("%w: near-death score must be zero", ErrInvalidStagePlan)
		}
	case "eliminated":
		if state.LifeState != LifeStateNearDeath || state.Score >= 0 || state.EliminatedStage == nil ||
			*state.EliminatedStage < 1 || *state.EliminatedStage >= stageIndex {
			return fmt.Errorf("%w: invalid eliminated player state", ErrInvalidStagePlan)
		}
	default:
		return fmt.Errorf("%w: unsupported elimination player status", ErrInvalidStagePlan)
	}
	if state.LifeState != LifeStateHealthy && state.LifeState != LifeStateNearDeath {
		return fmt.Errorf("%w: invalid elimination life state", ErrInvalidStagePlan)
	}
	return nil
}

func eliminationRosterSize(size int) bool {
	return size == 4 || size == 6 || size == 8
}
