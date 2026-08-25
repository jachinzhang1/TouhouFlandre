package relay

import (
	"fmt"
	"sort"
)

type LegacyWinsPolicy struct{}

func (p LegacyWinsPolicy) Settle(input SettlementInput) (SettlementDecision, error) {
	if input.Match.RuleSet != LegacyRuleSet() || input.Match.TargetWins < 1 || input.Match.MaxStages < 1 || len(input.Participants) != 2 || len(input.States) != 2 {
		return SettlementDecision{}, fmt.Errorf("%w: invalid legacy wins input", ErrInvalidStagePlan)
	}
	stateByMember := make(map[string]PlayerState, len(input.States))
	for _, state := range input.States {
		stateByMember[state.Player.MemberID] = state
	}
	decision := SettlementDecision{
		Players: make([]PlayerSettlement, 0, 2), Standings: make([]PlayerState, 0, 2),
	}
	for _, participant := range input.Participants {
		state, ok := stateByMember[participant.Player.MemberID]
		if !ok {
			return SettlementDecision{}, fmt.Errorf("%w: missing legacy player state", ErrInvalidStagePlan)
		}
		delta := 0
		if input.ForcedMatchEnd == nil && participant.Outcome == OutcomeWin {
			delta = 1
		}
		after := state.Score + delta
		decision.Players = append(decision.Players, PlayerSettlement{
			Player: participant.Player, EncounterID: participant.EncounterID, Assignment: participant.Assignment,
			Outcome: participant.Outcome, ScoreBefore: state.Score, ScoreDelta: delta, ScoreAfter: after,
			LifeBefore: state.LifeState, LifeAfter: state.LifeState, LifeTransition: LifeTransitionNone,
		})
		state.Score = after
		decision.Standings = append(decision.Standings, state)
	}
	scores := [2]int{}
	for _, state := range decision.Standings {
		if state.Player.Seat >= 1 && state.Player.Seat <= 2 {
			scores[state.Player.Seat-1] = state.Score
		}
	}
	if input.ForcedMatchEnd != nil {
		if input.ForcedMatchEnd.Reason == "" {
			return SettlementDecision{}, fmt.Errorf("%w: invalid forced legacy match end", ErrInvalidStagePlan)
		}
		var winner *string
		if input.ForcedMatchEnd.WinnerMemberID != nil {
			if _, ok := stateByMember[*input.ForcedMatchEnd.WinnerMemberID]; !ok {
				return SettlementDecision{}, fmt.Errorf("%w: invalid forced legacy match winner", ErrInvalidStagePlan)
			}
			value := *input.ForcedMatchEnd.WinnerMemberID
			winner = &value
		}
		decision.Match = &MatchDecision{
			ScoresBySeat: scores, Ended: true, WinnerMemberID: winner, Reason: input.ForcedMatchEnd.Reason,
			Ranking: legacyWinsRanking(decision.Standings, winner),
		}
		return decision, nil
	}
	ended := scores[0] >= input.Match.TargetWins || scores[1] >= input.Match.TargetWins || input.StageIndex >= input.Match.MaxStages
	var matchWinner *string
	if ended {
		for _, state := range decision.Standings {
			if state.Score >= input.Match.TargetWins {
				value := state.Player.MemberID
				matchWinner = &value
				break
			}
		}
	} else {
		decision.CreateNextStage = true
		for _, state := range decision.Standings {
			decision.NextPlayers = append(decision.NextPlayers, state.Player)
		}
	}
	reason := "normal"
	if ended && matchWinner == nil {
		reason = "round_cap"
	}
	decision.Match = &MatchDecision{ScoresBySeat: scores, Ended: ended, WinnerMemberID: matchWinner, Reason: reason}
	if ended {
		decision.Match.Ranking = legacyWinsRanking(decision.Standings, matchWinner)
	}
	return decision, nil
}

func legacyWinsRanking(states []PlayerState, winnerMemberID *string) []RankingEntry {
	ranked := append([]PlayerState(nil), states...)
	sort.Slice(ranked, func(i, j int) bool {
		if winnerMemberID != nil {
			iWinner := ranked[i].Player.MemberID == *winnerMemberID
			jWinner := ranked[j].Player.MemberID == *winnerMemberID
			if iWinner != jWinner {
				return iWinner
			}
		}
		if ranked[i].Score != ranked[j].Score {
			return ranked[i].Score > ranked[j].Score
		}
		return ranked[i].Player.Seat < ranked[j].Player.Seat
	})
	entries := make([]RankingEntry, 0, len(ranked))
	for index, state := range ranked {
		rank := 1
		if winnerMemberID != nil {
			if state.Player.MemberID != *winnerMemberID {
				rank = 2
			}
		} else if index > 0 && state.Score < ranked[index-1].Score {
			rank = index + 1
		} else if index > 0 {
			rank = entries[index-1].Rank
		}
		entries = append(entries, RankingEntry{
			Player: state.Player, Rank: rank, Score: state.Score, Status: state.Status,
			LifeState: state.LifeState, EliminatedStage: state.EliminatedStage,
		})
	}
	return entries
}
