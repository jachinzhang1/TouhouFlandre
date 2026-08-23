package multi

import "github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"

// RaceRules centralizes the frozen race scoring, elimination, and termination
// strategy for one match.
type RaceRules struct {
	scoringMode ScoringMode
}

// FrozenRaceScoringMode snapshots the scoring mode for a race room at match
// start. Two-player rooms always use wins; 3+ rooms switch between points and
// placement by the room toggle.
func FrozenRaceScoringMode(rosterSize int, eliminationEnabled bool) ScoringMode {
	if rosterSize <= 2 {
		return ScoringModeWins
	}
	if eliminationEnabled {
		return ScoringModePlacement
	}
	return ScoringModePoints
}

// FrozenRaceMaxRounds freezes the round cap for a race match. Wins/points use
// the selected total rounds; placement keeps the historical 3N safety cap.
func FrozenRaceMaxRounds(scoringMode ScoringMode, rosterSize int, format RoomFormat, factor int) int {
	switch scoringMode {
	case ScoringModePlacement:
		if rosterSize > 0 {
			return rosterSize * factor
		}
		return MaxRounds(format, factor)
	case ScoringModeWins, ScoringModePoints:
		return TotalRounds(format)
	default:
		return TotalRounds(format)
	}
}

// RaceRulesForMatch snapshots the strategy for a match row.
func RaceRulesForMatch(match repo.MultiMatch) RaceRules {
	return RaceRulesForScoringMode(ScoringMode(match.ScoringMode))
}

func RaceRulesForScoringMode(scoringMode ScoringMode) RaceRules {
	return RaceRules{scoringMode: scoringMode}
}

func (r RaceRules) ScoringMode() ScoringMode { return r.scoringMode }

func (r RaceRules) UsesPlacementScoring() bool {
	return r.scoringMode == ScoringModePoints || r.scoringMode == ScoringModePlacement
}

func (r RaceRules) UsesElimination() bool {
	return r.scoringMode == ScoringModePlacement
}

func (r RaceRules) MatchMaxRounds(format RoomFormat, rosterSize, factor int) int {
	return FrozenRaceMaxRounds(r.scoringMode, rosterSize, format, factor)
}

func (r RaceRules) ScoreRound(winnerMemberID string, activePlayerCount int, finishOrder []string) map[string]int {
	switch r.scoringMode {
	case ScoringModeWins:
		if winnerMemberID == "" {
			return map[string]int{}
		}
		return map[string]int{winnerMemberID: 1}
	case ScoringModePoints, ScoringModePlacement:
		return RacePlacement(activePlayerCount, finishOrder)
	default:
		return RacePlacement(activePlayerCount, finishOrder)
	}
}

func (r RaceRules) Eliminate(players []RaceParticipantScore, rosterSize, roundIndex int) []string {
	if !r.UsesElimination() {
		return nil
	}
	return RaceEliminationCandidates(players, rosterSize, roundIndex)
}

func (r RaceRules) MatchResult(match repo.MultiMatch, winnerMemberID string, players []RaceParticipantScore, roundCount int, fallbackMaxRounds int) RaceMatchResult {
	maxRounds := int(match.MaxRounds)
	if maxRounds <= 0 {
		maxRounds = fallbackMaxRounds
	}
	switch r.scoringMode {
	case ScoringModeWins:
		return WinsRaceMatchResultFor(int(match.TargetWins), winnerMemberID, players, roundCount, maxRounds)
	case ScoringModePoints:
		return PointsRaceMatchResultFor(players, roundCount, maxRounds)
	case ScoringModePlacement:
		return PlacementRaceMatchResultFor(players, int(match.RosterSize), roundCount, maxRounds)
	default:
		return PointsRaceMatchResultFor(players, roundCount, maxRounds)
	}
}
