package multi

import (
	"context"
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
