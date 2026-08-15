package multi

import (
	"context"
	"sort"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

type RaceMatchAdvance struct {
	MatchEnded     bool
	Reason         MatchEndReason
	WinnerMemberID *string
	Scores         []MemberScoreView
}

// CompleteRaceRoundTx settles a race round by stable roster member identity.
// The caller already owns the round then match locks, so concurrent correct
// guesses can produce at most one winner, score increment, and terminal event.
func CompleteRaceRoundTx(
	ctx context.Context,
	q *repo.Queries,
	room repo.MultiRoom,
	round repo.MultiRound,
	match repo.MultiMatch,
	winnerMemberID string,
	now time.Time,
	timing TimingConfig,
	forfeitedMemberIDs ...string,
) (RaceMatchAdvance, error) {
	if ScoringMode(match.ScoringMode) == ScoringModePlacement {
		return completePlacementRaceRoundTx(ctx, q, room, round, match, now, timing, forfeitedMemberIDs...)
	}
	if round.Status == string(RoundStatusEnded) {
		return RaceMatchAdvance{}, nil
	}
	var winner pgtype.Text
	var winnerView *string
	if winnerMemberID != "" {
		winner = pgtype.Text{String: winnerMemberID, Valid: true}
		value := winnerMemberID
		winnerView = &value
	}
	if _, err := q.EndRaceRound(ctx, repo.EndRaceRoundParams{
		ID:             round.ID,
		WinnerMemberID: winner,
		EndedAt:        pgtypeTimestamptz(now),
	}); err != nil {
		return RaceMatchAdvance{}, err
	}

	var winnerScore int
	if winnerMemberID != "" {
		winnerPlayer, err := q.IncrementMatchPlayerWin(ctx, repo.IncrementMatchPlayerWinParams{
			MatchID:  match.ID,
			MemberID: winnerMemberID,
		})
		if err != nil {
			return RaceMatchAdvance{}, err
		}
		winnerScore = int(winnerPlayer.Wins)
	}
	players, err := q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return RaceMatchAdvance{}, err
	}
	scores := MemberScoresForRoster(players)
	legacyScores := ScoresView{}
	for _, score := range scores {
		switch score.Seat {
		case 1:
			legacyScores.Slot1 = score.Score
		case 2:
			legacyScores.Slot2 = score.Score
		}
	}
	if _, err := q.UpdateMatchScore(ctx, repo.UpdateMatchScoreParams{
		ID:         match.ID,
		ScoreSlot1: int32(legacyScores.Slot1),
		ScoreSlot2: int32(legacyScores.Slot2),
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	advance := RaceMatchAdvance{Scores: scores}
	if winnerMemberID != "" && winnerScore >= int(match.TargetWins) {
		advance.MatchEnded = true
		advance.Reason = MatchEndReasonNormal
		advance.WinnerMemberID = winnerView
	} else if int(match.RoundCount) >= MaxRounds(RoomFormat(room.Format), timing.MaxRoundsFactor) {
		advance.MatchEnded = true
		advance.Reason = MatchEndReasonRoundCap
	}

	var forfeitedMemberID *string
	if len(forfeitedMemberIDs) > 0 && forfeitedMemberIDs[0] != "" {
		value := forfeitedMemberIDs[0]
		forfeitedMemberID = &value
	}
	nextStarts := now.Add(timing.Intermission)
	if err := AppendEvent(ctx, q, room.ID, EventRoundEnded, RoundEndedEventPayload{
		RoundID:           round.ID,
		MatchIndex:        int(match.MatchIndex),
		RoundIndex:        int(round.RoundIndex),
		WinnerMemberID:    winnerView,
		ForfeitedMemberID: forfeitedMemberID,
		AnswerID:          round.AnswerID,
		MemberScores:      scores,
		NextStartsAt:      &nextStarts,
	}); err != nil {
		return RaceMatchAdvance{}, err
	}

	if !advance.MatchEnded {
		return advance, nil
	}
	retentionEndsAt := now.Add(timing.FinishedRetention)
	if _, err := q.EndRaceMatch(ctx, repo.EndRaceMatchParams{
		ID:             match.ID,
		EndedAt:        pgtypeTimestamptz(now),
		WinnerMemberID: winner,
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        room.ID,
		Status:    string(RoomStatusFinished),
		ExpiresAt: pgtypeTimestamptz(retentionEndsAt),
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	if err := AppendEvent(ctx, q, room.ID, EventMatchEnded, MatchEndedEventPayload{
		MatchIndex:      int(match.MatchIndex),
		WinnerMemberID:  advance.WinnerMemberID,
		MemberScores:    scores,
		Reason:          advance.Reason,
		RetentionEndsAt: retentionEndsAt,
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	return advance, nil
}

func completePlacementRaceRoundTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, round repo.MultiRound, match repo.MultiMatch, now time.Time, timing TimingConfig, forfeitedMemberIDs ...string) (RaceMatchAdvance, error) {
	if round.Status == string(RoundStatusEnded) {
		return RaceMatchAdvance{}, nil
	}
	// Any participant still active at the deadline is a zero-point timeout.
	if _, err := q.MarkRoundPlayerTimedOut(ctx, repo.MarkRoundPlayerTimedOutParams{RoundID: round.ID, CompletedAt: pgtypeTimestamptz(now)}); err != nil {
		return RaceMatchAdvance{}, err
	}
	participants, err := q.ListRoundPlayers(ctx, round.ID)
	if err != nil {
		return RaceMatchAdvance{}, err
	}
	finishOrder := make([]string, 0, len(participants))
	for _, participant := range participants {
		if participant.Status == "correct" && participant.FinishRank.Valid {
			finishOrder = append(finishOrder, participant.MemberID)
		}
	}
	// finishRank is assigned under the round lock by the guess handler. Sort
	// defensively so event order cannot change point ownership.
	sort.SliceStable(participants, func(i, j int) bool {
		if participants[i].FinishRank.Valid != participants[j].FinishRank.Valid {
			return participants[i].FinishRank.Valid
		}
		if participants[i].FinishRank.Valid && participants[i].FinishRank.Int32 != participants[j].FinishRank.Int32 {
			return participants[i].FinishRank.Int32 < participants[j].FinishRank.Int32
		}
		return participants[i].MemberID < participants[j].MemberID
	})
	finishOrder = finishOrder[:0]
	for _, participant := range participants {
		if participant.Status == "correct" {
			finishOrder = append(finishOrder, participant.MemberID)
		}
	}
	var roundWinner pgtype.Text
	var roundWinnerView *string
	if len(finishOrder) > 0 {
		roundWinner = pgtype.Text{String: finishOrder[0], Valid: true}
		value := finishOrder[0]
		roundWinnerView = &value
	}
	if _, err := q.EndRaceRound(ctx, repo.EndRaceRoundParams{ID: round.ID, WinnerMemberID: roundWinner, EndedAt: pgtypeTimestamptz(now)}); err != nil {
		return RaceMatchAdvance{}, err
	}
	points := RacePlacement(len(participants), finishOrder)
	for _, participant := range participants {
		if _, err := q.AwardRoundPlayerPoints(ctx, repo.AwardRoundPlayerPointsParams{RoundID: round.ID, MemberID: participant.MemberID, Points: int32(points[participant.MemberID])}); err != nil {
			return RaceMatchAdvance{}, err
		}
		if points[participant.MemberID] > 0 {
			if _, err := q.AwardMatchPlayerPoints(ctx, repo.AwardMatchPlayerPointsParams{MatchID: match.ID, MemberID: participant.MemberID, Points: int32(points[participant.MemberID])}); err != nil {
				return RaceMatchAdvance{}, err
			}
		}
	}
	players, err := q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return RaceMatchAdvance{}, err
	}
	standings := raceStandingsForRoster(players)
	eliminated := RaceEliminationCandidates(standings, int(match.RosterSize), int(round.RoundIndex))
	for _, memberID := range eliminated {
		if _, err := q.MarkMatchPlayerEliminated(ctx, repo.MarkMatchPlayerEliminatedParams{MatchID: match.ID, MemberID: memberID, RoundIndex: pgtype.Int4{Int32: round.RoundIndex, Valid: true}}); err != nil {
			return RaceMatchAdvance{}, err
		}
	}
	if len(eliminated) > 0 {
		players, err = q.ListMatchPlayers(ctx, match.ID)
		if err != nil {
			return RaceMatchAdvance{}, err
		}
		standings = raceStandingsForRoster(players)
	}
	var slotScores ScoresView
	for _, player := range players {
		if player.Seat == 1 {
			slotScores.Slot1 = int(player.Score)
		}
		if player.Seat == 2 {
			slotScores.Slot2 = int(player.Score)
		}
	}
	if _, err := q.UpdateMatchScore(ctx, repo.UpdateMatchScoreParams{ID: match.ID, ScoreSlot1: int32(slotScores.Slot1), ScoreSlot2: int32(slotScores.Slot2)}); err != nil {
		return RaceMatchAdvance{}, err
	}
	scores := MemberScoresForRoster(players)
	placementViews := make([]RoundPlacementView, 0, len(participants))
	for _, participant := range participants {
		var rank *int
		if participant.FinishRank.Valid {
			value := int(participant.FinishRank.Int32)
			rank = &value
		}
		placementViews = append(placementViews, RoundPlacementView{MemberID: participant.MemberID, Seat: seatForMember(players, participant.MemberID), Status: participant.Status, FinishRank: rank, PointsAwarded: points[participant.MemberID]})
	}
	result := RaceMatchResultFor(standings, int(match.RosterSize), int(match.RoundCount), int(match.MaxRounds))
	if match.MaxRounds == 0 {
		result = RaceMatchResultFor(standings, int(match.RosterSize), int(match.RoundCount), int(match.RosterSize)*timing.MaxRoundsFactor)
	}
	advance := RaceMatchAdvance{MatchEnded: result.Ended, Reason: result.Reason, WinnerMemberID: result.WinnerMemberID, Scores: scores}
	nextStarts := now.Add(timing.Intermission)
	if err := AppendEvent(ctx, q, room.ID, EventRoundEnded, RoundEndedEventPayload{RoundID: round.ID, MatchIndex: int(match.MatchIndex), RoundIndex: int(round.RoundIndex), WinnerMemberID: roundWinnerView, AnswerID: round.AnswerID, MemberScores: scores, Placements: placementViews, EliminatedMemberIDs: eliminated, NextStartsAt: &nextStarts}); err != nil {
		return RaceMatchAdvance{}, err
	}
	if !advance.MatchEnded {
		return advance, nil
	}
	retentionEndsAt := now.Add(timing.FinishedRetention)
	var winner pgtype.Text
	if result.WinnerMemberID != nil {
		winner = pgtype.Text{String: *result.WinnerMemberID, Valid: true}
	}
	if _, err := q.EndRaceMatch(ctx, repo.EndRaceMatchParams{ID: match.ID, EndedAt: pgtypeTimestamptz(now), WinnerMemberID: winner}); err != nil {
		return RaceMatchAdvance{}, err
	}
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{ID: room.ID, Status: string(RoomStatusFinished), ExpiresAt: pgtypeTimestamptz(retentionEndsAt)}); err != nil {
		return RaceMatchAdvance{}, err
	}
	ranking := raceRankingForRoster(players)
	if err := AppendEvent(ctx, q, room.ID, EventMatchEnded, MatchEndedEventPayload{MatchIndex: int(match.MatchIndex), WinnerMemberID: result.WinnerMemberID, MemberScores: scores, Ranking: ranking, Reason: result.Reason, RetentionEndsAt: retentionEndsAt}); err != nil {
		return RaceMatchAdvance{}, err
	}
	return advance, nil
}

func raceStandingsForRoster(players []repo.MultiMatchPlayer) []RaceParticipantScore {
	standings := make([]RaceParticipantScore, 0, len(players))
	for _, player := range players {
		standings = append(standings, RaceParticipantScore{
			MemberID:       player.MemberID,
			Seat:           int(player.Seat),
			Score:          int(player.Score),
			BestRoundScore: int(player.BestRoundScore),
			Status:         player.Status,
		})
	}
	return standings
}

func raceRankingForRoster(players []repo.MultiMatchPlayer) []MemberRankingView {
	ranking := make([]MemberRankingView, 0, len(players))
	for _, entry := range RaceRanking(raceStandingsForRoster(players)) {
		var eliminatedRound *int
		for _, player := range players {
			if player.MemberID == entry.MemberID {
				eliminatedRound = intPointer(player.EliminatedRound)
				break
			}
		}
		ranking = append(ranking, MemberRankingView{
			MemberID:        entry.MemberID,
			Seat:            entry.Seat,
			Rank:            entry.Rank,
			Score:           entry.Score,
			Status:          entry.Status,
			EliminatedRound: eliminatedRound,
		})
	}
	return ranking
}

func seatForMember(players []repo.MultiMatchPlayer, memberID string) int {
	for _, player := range players {
		if player.MemberID == memberID {
			return int(player.Seat)
		}
	}
	return 0
}
