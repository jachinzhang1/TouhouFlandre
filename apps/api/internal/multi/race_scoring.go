package multi

import "sort"

// RaceParticipantScore is the durable standings input used by the placement
// race rules. The slice is intentionally keyed by member id; seat is only a
// stable display tie-breaker.
type RaceParticipantScore struct {
	MemberID       string
	Seat           int
	Score          int
	BestRoundScore int
	Status         string
}

// RacePlacement is the points table for one placement round. A player that
// does not finish successfully receives zero points and is not assigned a
// finish rank.
func RacePlacement(activePlayerCount int, finishOrder []string) map[string]int {
	points := make(map[string]int, len(finishOrder))
	if activePlayerCount < 1 {
		return points
	}
	seen := make(map[string]struct{}, len(finishOrder))
	rank := 0
	for _, memberID := range finishOrder {
		if memberID == "" {
			continue
		}
		if _, ok := seen[memberID]; ok {
			continue
		}
		seen[memberID] = struct{}{}
		rank++
		points[memberID] = activePlayerCount - rank + 1
	}
	return points
}

// RaceEliminationCandidates returns all active players tied at the lowest
// score and lowest historical single-round score. If the tie includes every
// active player, no one is eliminated for that round.
func RaceEliminationCandidates(players []RaceParticipantScore, rosterSize, roundIndex int) []string {
	threshold := rosterSize / 2
	if rosterSize <= 2 || roundIndex < threshold {
		return nil
	}
	active := make([]RaceParticipantScore, 0, len(players))
	for _, player := range players {
		if player.Status == "active" {
			active = append(active, player)
		}
	}
	if len(active) <= 1 {
		return nil
	}
	minScore := active[0].Score
	for _, player := range active[1:] {
		if player.Score < minScore {
			minScore = player.Score
		}
	}
	minBest := int(^uint(0) >> 1)
	for _, player := range active {
		if player.Score == minScore && player.BestRoundScore < minBest {
			minBest = player.BestRoundScore
		}
	}
	candidates := make([]string, 0, len(active))
	for _, player := range active {
		if player.Score == minScore && player.BestRoundScore == minBest {
			candidates = append(candidates, player.MemberID)
		}
	}
	if len(candidates) == len(active) {
		return nil
	}
	return candidates
}

// RaceMatchResult is the terminal condition and winner projection for a
// placement match. A nil winner means a draw (including a tied first place).
type RaceMatchResult struct {
	Ended          bool
	Reason         MatchEndReason
	WinnerMemberID *string
}

func RaceMatchResultFor(players []RaceParticipantScore, rosterSize, roundCount, maxRounds int) RaceMatchResult {
	active := make([]RaceParticipantScore, 0, len(players))
	for _, player := range players {
		if player.Status == "active" {
			active = append(active, player)
		}
	}
	if len(active) <= 1 {
		return RaceMatchResult{Ended: true, Reason: MatchEndReasonNormal, WinnerMemberID: uniqueTop(players)}
	}
	if len(active) == 2 {
		diff := active[0].Score - active[1].Score
		if diff < 0 {
			diff = -diff
		}
		if diff > 1 {
			return RaceMatchResult{Ended: true, Reason: MatchEndReasonNormal, WinnerMemberID: uniqueTop(players)}
		}
	}
	if maxRounds > 0 && roundCount >= maxRounds {
		return RaceMatchResult{Ended: true, Reason: MatchEndReasonRoundCap, WinnerMemberID: uniqueTop(players)}
	}
	return RaceMatchResult{}
}

// RaceRanking computes shared competition ranks (1,1,3) across the complete
// roster, retaining eliminated/left statuses for the final result screen.
func RaceRanking(players []RaceParticipantScore) []RaceRankingEntry {
	sorted := append([]RaceParticipantScore(nil), players...)
	sort.SliceStable(sorted, func(i, j int) bool {
		if sorted[i].Score != sorted[j].Score {
			return sorted[i].Score > sorted[j].Score
		}
		if sorted[i].Seat != sorted[j].Seat {
			return sorted[i].Seat < sorted[j].Seat
		}
		return sorted[i].MemberID < sorted[j].MemberID
	})
	ranking := make([]RaceRankingEntry, 0, len(sorted))
	for i, player := range sorted {
		rank := i + 1
		if i > 0 && player.Score == sorted[i-1].Score {
			rank = ranking[i-1].Rank
		}
		ranking = append(ranking, RaceRankingEntry{
			MemberID: player.MemberID,
			Rank:     rank,
			Score:    player.Score,
			Status:   player.Status,
			Seat:     player.Seat,
		})
	}
	return ranking
}

type RaceRankingEntry struct {
	MemberID string
	Rank     int
	Score    int
	Status   string
	Seat     int
}

func uniqueTop(players []RaceParticipantScore) *string {
	if len(players) == 0 {
		return nil
	}
	top := players[0].Score
	var winner *string
	for _, player := range players {
		if player.Score > top {
			top = player.Score
			value := player.MemberID
			winner = &value
		} else if player.Score == top {
			if winner == nil {
				value := player.MemberID
				winner = &value
			} else {
				return nil
			}
		}
	}
	return winner
}
