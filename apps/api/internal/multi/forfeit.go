// 弃赛/断线判负（08 §4.6、§9.2 锁序纪律）。
// 供 REST leave 与 sweeper 宽限逾期共用：锁序 局→场→房间，绝不先锁房间。
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
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

// ForfeitMemberMatch resolves persisted mode/ruleset state before
// choosing a completion driver. Unknown combinations fail before any write.
func ForfeitMemberMatch(ctx context.Context, pool *pgxpool.Pool, member repo.MultiMember, reason MatchEndReason, now time.Time, timing TimingConfig, registry *core.Registry) error {
	room, err := repo.New(pool).GetRoom(ctx, member.RoomID)
	if err != nil {
		return err
	}
	if registry == nil {
		return &core.DomainError{Code: core.ErrorMissingCapability, Mode: core.Mode(room.Mode), Capability: "completion_driver"}
	}
	activeMatch, err := repo.New(pool).GetActiveMatchForUpdate(ctx, member.RoomID)
	if err != nil {
		return err
	}
	ref, err := registry.ResolveLegacy(core.Mode(room.Mode), activeMatch.ScoringMode)
	if err != nil {
		return err
	}
	driver, err := registry.CompletionDriver(ref.Mode)
	if err != nil {
		return err
	}
	route, err := driver.Route(ref)
	if err != nil {
		return err
	}
	if route == core.CompletionRouteRace {
		return ForfeitRaceMembersMatch(ctx, pool, []repo.MultiMember{member}, reason, now, timing)
	}
	DefaultMetrics.IncForfeits(string(reason))
	slog.Info("match forfeited", "room_id", member.RoomID, "member_id", member.ID, "reason", string(reason))
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	// 1. 锁局行（房间当前场的最新局；无 active 局时返回已结束局或 ErrNoRows）
	round, err := q.GetCurrentRoundForUpdateByRoom(ctx, member.RoomID)
	hasRound := true
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			hasRound = false
		} else {
			return err
		}
	}

	// 2. 锁场行（局→场→房间）
	var match repo.MultiMatch
	if hasRound {
		match, err = q.GetMatchForUpdate(ctx, round.MatchID)
	} else {
		match, err = q.GetActiveMatchForUpdate(ctx, member.RoomID)
	}
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return errors.New("forfeit: no active match")
		}
		return err
	}
	opponentSlot := OtherSlot(MemberSeat(member))

	// 3. 结束当前局（对方胜）——仅 countdown/playing 局；已 ended 的局保持原结果
	if hasRound && round.Status != string(RoundStatusEnded) {
		winner := pgtype.Int4{Int32: int32(opponentSlot), Valid: true}
		if _, err := q.EndRound(ctx, repo.EndRoundParams{ID: round.ID, WinnerSlot: winner, EndedAt: pgtypeTimestamptz(now)}); err != nil {
			return err
		}
		scores := ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)}
		nextStarts := now.Add(timing.Intermission)
		forfeitedSlot := MemberSeat(member)
		if err := AppendEvent(ctx, q, member.RoomID, EventRoundEnded, RoundEndedEventPayload{
			RoundID:       round.ID,
			MatchIndex:    int(match.MatchIndex),
			RoundIndex:    int(round.RoundIndex),
			WinnerSlot:    &opponentSlot,
			ForfeitedSlot: &forfeitedSlot,
			AnswerID:      round.AnswerID,
			Scores:        scores,
			NextStartsAt:  &nextStarts,
		}); err != nil {
			return err
		}
	}

	// 4. 场次与房间 finished
	if _, err := q.EndMatch(ctx, repo.EndMatchParams{
		ID:         match.ID,
		EndedAt:    pgtypeTimestamptz(now),
		WinnerSeat: pgtype.Int4{Int32: int32(opponentSlot), Valid: true},
	}); err != nil {
		return err
	}
	expires := now.Add(timing.FinishedRetention)
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        member.RoomID,
		Status:    string(RoomStatusFinished),
		ExpiresAt: pgtypeTimestamptz(expires),
	}); err != nil {
		return err
	}
	winnerSlot := opponentSlot
	if err := AppendEvent(ctx, q, member.RoomID, EventMatchEnded, MatchEndedEventPayload{
		MatchIndex:      int(match.MatchIndex),
		WinnerSlot:      &winnerSlot,
		Scores:          ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
		Reason:          reason,
		RetentionEndsAt: expires,
	}); err != nil {
		return err
	}

	// 5. 成员行置 left（保留供结果展示/审计，§6.2）
	if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
		ID:         member.ID,
		Status:     string(MemberStatusLeft),
		GraceUntil: pgtype.Timestamptz{},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
