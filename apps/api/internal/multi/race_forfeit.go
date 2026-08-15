package multi

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

var ErrRaceRoundPlayerInactive = errors.New("race round player is not active")

// ForfeitRaceRoundTx only removes one roster member from the current race round.
// The match roster remains intact, so the member is eligible again when the next
// round is created. The caller owns the round then match locks.
func ForfeitRaceRoundTx(
	ctx context.Context,
	q *repo.Queries,
	room repo.MultiRoom,
	round repo.MultiRound,
	match repo.MultiMatch,
	memberID string,
	now time.Time,
	timing TimingConfig,
) (RaceMatchAdvance, bool, error) {
	affected, err := q.ForfeitRoundPlayer(ctx, repo.ForfeitRoundPlayerParams{RoundID: round.ID, MemberID: memberID})
	if err != nil {
		return RaceMatchAdvance{}, false, err
	}
	if affected == 0 {
		return RaceMatchAdvance{}, false, ErrRaceRoundPlayerInactive
	}
	advance, ended, err := settleRaceRoundRosterTx(ctx, q, room, round, match, memberID, now, timing)
	return advance, ended, err
}

// settleRaceRoundRosterTx applies the N-player round terminal table after a
// forfeit/leave mutation: one active player wins; zero active players or all
// remaining active players exhausted means draw; otherwise the round continues.
func settleRaceRoundRosterTx(
	ctx context.Context,
	q *repo.Queries,
	room repo.MultiRoom,
	round repo.MultiRound,
	match repo.MultiMatch,
	forfeitedMemberID string,
	now time.Time,
	timing TimingConfig,
) (RaceMatchAdvance, bool, error) {
	active, err := q.ListActiveRoundPlayers(ctx, round.ID)
	if err != nil {
		return RaceMatchAdvance{}, false, err
	}
	if ScoringMode(match.ScoringMode) == ScoringModePlacement {
		if len(active) > 0 {
			return RaceMatchAdvance{}, false, nil
		}
		advance, err := CompleteRaceRoundTx(ctx, q, room, round, match, "", now, timing, forfeitedMemberID)
		return advance, true, err
	}
	winnerMemberID := ""
	shouldEnd := len(active) <= 1
	if len(active) == 1 {
		winnerMemberID = active[0].MemberID
	}
	if !shouldEnd {
		counts, err := q.ListRoundPlayerGuessCounts(ctx, round.ID)
		if err != nil {
			return RaceMatchAdvance{}, false, err
		}
		shouldEnd = len(counts) == len(active) && len(counts) > 0
		for _, count := range counts {
			if int(count.GuessCount) < MaxGuessesForMatch(match) {
				shouldEnd = false
				break
			}
		}
	}
	if !shouldEnd {
		return RaceMatchAdvance{}, false, nil
	}
	advance, err := CompleteRaceRoundTx(ctx, q, room, round, match, winnerMemberID, now, timing, forfeitedMemberID)
	return advance, true, err
}

// EndRaceRoundWithoutScoreTx closes a race round without awarding a roster win.
// It is used by match-level departure and restart termination, preserving the
// existing two-player forfeit score while still publishing N-player collections.
func EndRaceRoundWithoutScoreTx(
	ctx context.Context,
	q *repo.Queries,
	room repo.MultiRoom,
	round repo.MultiRound,
	match repo.MultiMatch,
	winnerMemberID string,
	forfeitedMemberID string,
	now time.Time,
	timing TimingConfig,
) error {
	var placements []RoundPlacementView
	if ScoringMode(match.ScoringMode) == ScoringModePlacement {
		if _, err := q.MarkRoundPlayerTimedOut(ctx, repo.MarkRoundPlayerTimedOutParams{
			RoundID: round.ID, CompletedAt: pgtypeTimestamptz(now),
		}); err != nil {
			return err
		}
		participants, err := q.ListRoundPlayers(ctx, round.ID)
		if err != nil {
			return err
		}
		players, err := q.ListMatchPlayers(ctx, match.ID)
		if err != nil {
			return err
		}
		placements = make([]RoundPlacementView, 0, len(participants))
		for _, participant := range participants {
			var finishRank *int
			if participant.FinishRank.Valid {
				value := int(participant.FinishRank.Int32)
				finishRank = &value
			}
			placements = append(placements, RoundPlacementView{
				MemberID: participant.MemberID, Seat: seatForMember(players, participant.MemberID),
				Status: participant.Status, FinishRank: finishRank, PointsAwarded: int(participant.PointsAwarded),
			})
		}
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
		return err
	}
	players, err := q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return err
	}
	var forfeitedView *string
	if forfeitedMemberID != "" {
		value := forfeitedMemberID
		forfeitedView = &value
	}
	nextStarts := now.Add(timing.Intermission)
	return AppendEvent(ctx, q, room.ID, EventRoundEnded, RoundEndedEventPayload{
		RoundID:           round.ID,
		MatchIndex:        int(match.MatchIndex),
		RoundIndex:        int(round.RoundIndex),
		WinnerMemberID:    winnerView,
		ForfeitedMemberID: forfeitedView,
		AnswerID:          round.AnswerID,
		MemberScores:      MemberScoresForRoster(players),
		Placements:        placements,
		NextStartsAt:      &nextStarts,
	})
}

// EndRaceMatchTx closes a race match using stable roster identity and scores.
func EndRaceMatchTx(
	ctx context.Context,
	q *repo.Queries,
	room repo.MultiRoom,
	match repo.MultiMatch,
	winnerMemberID string,
	reason MatchEndReason,
	now time.Time,
	timing TimingConfig,
) (RaceMatchAdvance, error) {
	players, err := q.ListMatchPlayers(ctx, match.ID)
	if err != nil {
		return RaceMatchAdvance{}, err
	}
	scores := MemberScoresForRoster(players)
	var ranking []MemberRankingView
	var winnerView *string
	if ScoringMode(match.ScoringMode) == ScoringModePlacement {
		winnerView = uniqueTop(raceStandingsForRoster(players))
		ranking = raceRankingForRoster(players)
	} else if winnerMemberID != "" {
		value := winnerMemberID
		winnerView = &value
	}
	var winner pgtype.Text
	if winnerView != nil {
		winner = pgtype.Text{String: *winnerView, Valid: true}
	}
	if _, err := q.EndRaceMatch(ctx, repo.EndRaceMatchParams{
		ID:             match.ID,
		EndedAt:        pgtypeTimestamptz(now),
		WinnerMemberID: winner,
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	retentionEndsAt := now.Add(timing.FinishedRetention)
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        room.ID,
		Status:    string(RoomStatusFinished),
		ExpiresAt: pgtypeTimestamptz(retentionEndsAt),
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	if err := AppendEvent(ctx, q, room.ID, EventMatchEnded, MatchEndedEventPayload{
		MatchIndex:      int(match.MatchIndex),
		WinnerMemberID:  winnerView,
		MemberScores:    scores,
		Ranking:         ranking,
		Reason:          reason,
		RetentionEndsAt: retentionEndsAt,
	}); err != nil {
		return RaceMatchAdvance{}, err
	}
	return RaceMatchAdvance{MatchEnded: true, Reason: reason, WinnerMemberID: winnerView, Scores: scores}, nil
}

// ForfeitRaceMembersMatch marks one or more race roster members left in one
// transaction. A sweeper passes every member that expired in the same tick so
// zero survivors is a draw instead of an iteration-order winner.
func ForfeitRaceMembersMatch(
	ctx context.Context,
	pool *pgxpool.Pool,
	members []repo.MultiMember,
	reason MatchEndReason,
	now time.Time,
	timing TimingConfig,
) error {
	if len(members) == 0 {
		return nil
	}
	roomID := members[0].RoomID
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	round, err := q.GetCurrentRoundForUpdateByRoom(ctx, roomID)
	hasRound := true
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			hasRound = false
		} else {
			return err
		}
	}
	var match repo.MultiMatch
	if hasRound {
		match, err = q.GetMatchForUpdate(ctx, round.MatchID)
	} else {
		match, err = q.GetActiveMatchForUpdate(ctx, roomID)
	}
	if err != nil {
		return err
	}
	room, err := q.GetRoomForUpdate(ctx, roomID)
	if err != nil {
		return err
	}
	if room.Status != string(RoomStatusPlaying) || MultiplayerMode(room.Mode) != MultiplayerModeRace || match.Status != string(MatchStatusPlaying) {
		return tx.Commit(ctx)
	}

	changed := make([]string, 0, len(members))
	for _, member := range members {
		if member.RoomID != roomID {
			return errors.New("race departure batch spans rooms")
		}
		affected, err := q.MarkMatchPlayerLeft(ctx, repo.MarkMatchPlayerLeftParams{MatchID: match.ID, MemberID: member.ID})
		if err != nil {
			return err
		}
		if affected == 0 {
			continue
		}
		changed = append(changed, member.ID)
		if hasRound && round.Status != string(RoundStatusEnded) {
			if _, err := q.ForfeitDepartedRoundPlayer(ctx, repo.ForfeitDepartedRoundPlayerParams{RoundID: round.ID, MemberID: member.ID}); err != nil {
				return err
			}
		}
		if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
			ID: member.ID, Status: string(MemberStatusLeft), GraceUntil: pgtype.Timestamptz{},
		}); err != nil {
			return err
		}
	}
	if len(changed) == 0 {
		return tx.Commit(ctx)
	}
	remaining, err := q.ListActiveMatchPlayers(ctx, match.ID)
	if err != nil {
		return err
	}
	membersAfter, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return err
	}
	spectators, err := q.CountSpectators(ctx, room.ID)
	if err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, room.ID, EventRoomUpdated, NewRoomUpdatedPayload(room, membersAfter, int(spectators))); err != nil {
		return err
	}

	if len(remaining) <= 1 {
		winnerMemberID := ""
		if len(remaining) == 1 {
			winnerMemberID = remaining[0].MemberID
		}
		if hasRound && round.Status != string(RoundStatusEnded) {
			roundWinnerMemberID := ""
			activeRoundPlayers, err := q.ListActiveRoundPlayers(ctx, round.ID)
			if err != nil {
				return err
			}
			if len(activeRoundPlayers) == 1 {
				roundWinnerMemberID = activeRoundPlayers[0].MemberID
			}
			forfeitedMemberID := ""
			if len(changed) == 1 {
				forfeitedMemberID = changed[0]
			}
			if err := EndRaceRoundWithoutScoreTx(ctx, q, room, round, match, roundWinnerMemberID, forfeitedMemberID, now, timing); err != nil {
				return err
			}
		}
		if _, err := EndRaceMatchTx(ctx, q, room, match, winnerMemberID, reason, now, timing); err != nil {
			return err
		}
	} else if hasRound && round.Status != string(RoundStatusEnded) {
		forfeitedMemberID := ""
		if len(changed) == 1 {
			forfeitedMemberID = changed[0]
		}
		if _, _, err := settleRaceRoundRosterTx(ctx, q, room, round, match, forfeitedMemberID, now, timing); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	for _, memberID := range changed {
		DefaultMetrics.IncForfeits(string(reason))
		slog.Info("race roster member left", "room_id", roomID, "member_id", memberID, "reason", string(reason))
	}
	return nil
}
