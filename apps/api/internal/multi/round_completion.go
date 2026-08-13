package multi

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// CompleteRoundTx 结束单局并推进比分/整场状态。调用方须已按 局→场→房间 锁序进入事务。
func CompleteRoundTx(ctx context.Context, q *repo.Queries, room repo.MultiRoom, round repo.MultiRound, match repo.MultiMatch, winnerSlot int, now time.Time, timing TimingConfig, forfeitedSlots ...int) (MatchAdvance, error) {
	var winner pgtype.Int4
	if winnerSlot != 0 {
		winner = pgtype.Int4{Int32: int32(winnerSlot), Valid: true}
	}
	if _, err := q.EndRound(ctx, repo.EndRoundParams{
		ID:         round.ID,
		WinnerSlot: winner,
		EndedAt:    pgtypeTimestamptz(now),
	}); err != nil {
		return MatchAdvance{}, err
	}

	advance := AdvanceMatch(
		[2]int{int(match.ScoreSlot1), int(match.ScoreSlot2)},
		int(match.TargetWins),
		int(match.RoundCount),
		MaxRounds(RoomFormat(room.Format), timing.MaxRoundsFactor),
		winnerSlot,
	)
	if _, err := q.UpdateMatchScore(ctx, repo.UpdateMatchScoreParams{
		ID:         match.ID,
		ScoreSlot1: int32(advance.Score[0]),
		ScoreSlot2: int32(advance.Score[1]),
	}); err != nil {
		return MatchAdvance{}, err
	}

	var roundWinnerSlot *int
	if winnerSlot != 0 {
		slot := winnerSlot
		roundWinnerSlot = &slot
	}
	var forfeitedSlot *int
	if len(forfeitedSlots) > 0 && forfeitedSlots[0] != 0 {
		slot := forfeitedSlots[0]
		forfeitedSlot = &slot
	}
	nextStarts := now.Add(timing.Intermission)
	if err := AppendEvent(ctx, q, room.ID, EventRoundEnded, RoundEndedEventPayload{
		RoundID:       round.ID,
		MatchIndex:    int(match.MatchIndex),
		RoundIndex:    int(round.RoundIndex),
		WinnerSlot:    roundWinnerSlot,
		ForfeitedSlot: forfeitedSlot,
		AnswerID:      round.AnswerID,
		Scores:        ScoresView{Slot1: advance.Score[0], Slot2: advance.Score[1]},
		NextStartsAt:  &nextStarts,
	}); err != nil {
		return MatchAdvance{}, err
	}

	if advance.MatchEnded {
		retentionEndsAt := now.Add(timing.FinishedRetention)
		var winnerSeat pgtype.Int4
		if advance.WinnerSlot != 0 {
			winnerSeat = pgtype.Int4{Int32: int32(advance.WinnerSlot), Valid: true}
		}
		if _, err := q.EndMatch(ctx, repo.EndMatchParams{ID: match.ID, EndedAt: pgtypeTimestamptz(now), WinnerSeat: winnerSeat}); err != nil {
			return MatchAdvance{}, err
		}
		if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
			ID:        room.ID,
			Status:    string(RoomStatusFinished),
			ExpiresAt: pgtypeTimestamptz(retentionEndsAt),
		}); err != nil {
			return MatchAdvance{}, err
		}
		var matchWinnerSlot *int
		if advance.WinnerSlot != 0 {
			slot := advance.WinnerSlot
			matchWinnerSlot = &slot
		}
		if err := AppendEvent(ctx, q, room.ID, EventMatchEnded, MatchEndedEventPayload{
			MatchIndex:      int(match.MatchIndex),
			WinnerSlot:      matchWinnerSlot,
			Scores:          ScoresView{Slot1: advance.Score[0], Slot2: advance.Score[1]},
			Reason:          advance.Reason,
			RetentionEndsAt: retentionEndsAt,
		}); err != nil {
			return MatchAdvance{}, err
		}
	}
	return advance, nil
}
