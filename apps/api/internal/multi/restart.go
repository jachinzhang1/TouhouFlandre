// 服务重启明确终止（08 §4.6/§6.3）：启动时对进行中对局（含 countdown 态局）执行
// round.ended(平局) + match.ended(reason=server_restart, result=draw)，不静默丢失。
package multi

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

// TerminateActiveMatches resolves persisted rules before recovery.
// Unknown mode/key/version returns without writing a guessed terminal state.
func TerminateActiveMatches(ctx context.Context, pool *pgxpool.Pool, now time.Time, timing TimingConfig, registry *core.Registry) (int, error) {
	if registry == nil {
		return 0, &core.DomainError{Code: core.ErrorMissingCapability, Capability: "recovery_driver"}
	}
	matches, err := repo.New(pool).ListActiveMatches(ctx)
	if err != nil {
		return 0, err
	}
	terminated := 0
	for _, match := range matches {
		if err := terminateMatch(ctx, pool, match, now, timing, registry); err != nil {
			return terminated, err
		}
		terminated++
	}
	return terminated, nil
}

func terminateMatch(ctx context.Context, pool *pgxpool.Pool, match repo.MultiMatch, now time.Time, timing TimingConfig, registry *core.Registry) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	// 1. 锁局行（局→场→房间）
	round, err := q.GetActiveRoundForUpdate(ctx, match.ID)
	hasRound := true
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			hasRound = false
		} else {
			return err
		}
	}
	// 2. 锁场行并复核仍 playing（幂等：重启后再重启不重复终止）
	locked, err := q.GetMatchForUpdate(ctx, match.ID)
	if err != nil {
		return err
	}
	if locked.Status != string(MatchStatusPlaying) {
		return tx.Commit(ctx)
	}
	room, err := q.GetRoomForUpdate(ctx, locked.RoomID)
	if err != nil {
		return err
	}
	ref, err := ResolveMatchRuleSet(registry, room, locked)
	if err != nil {
		return err
	}
	driver, err := registry.RecoveryDriver(ref.Mode)
	if err != nil {
		return err
	}
	route, err := driver.Route(ref)
	if err != nil {
		return err
	}
	if route == core.RecoveryRouteRace {
		if hasRound {
			if err := EndRaceRoundWithoutScoreTx(ctx, q, room, round, locked, "", "", now, timing); err != nil {
				return err
			}
		}
		if _, err := EndRaceMatchTx(ctx, q, room, locked, "", MatchEndReasonServerRestart, now, timing); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	// 3. 终止当前局（平局；含 countdown 态局）
	if hasRound {
		if _, err := q.EndRound(ctx, repo.EndRoundParams{
			ID:         round.ID,
			WinnerSlot: pgtype.Int4{},
			EndedAt:    pgtypeTimestamptz(now),
		}); err != nil {
			return err
		}
		nextStarts := now.Add(timing.Intermission)
		if err := AppendEvent(ctx, q, match.RoomID, EventRoundEnded, RoundEndedEventPayload{
			RoundID:      round.ID,
			MatchIndex:   int(match.MatchIndex),
			RoundIndex:   int(round.RoundIndex),
			WinnerSlot:   nil,
			AnswerID:     round.AnswerID,
			Scores:       ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
			NextStartsAt: &nextStarts,
		}); err != nil {
			return err
		}
	}
	// 4. 场次与房间 finished
	if _, err := q.EndMatch(ctx, repo.EndMatchParams{ID: match.ID, EndedAt: pgtypeTimestamptz(now), WinnerSeat: pgtype.Int4{}}); err != nil {
		return err
	}
	retentionEndsAt := now.Add(timing.FinishedRetention)
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        match.RoomID,
		Status:    string(RoomStatusFinished),
		ExpiresAt: pgtypeTimestamptz(retentionEndsAt),
	}); err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, match.RoomID, EventMatchEnded, MatchEndedEventPayload{
		MatchIndex:      int(match.MatchIndex),
		WinnerSlot:      nil,
		Scores:          ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
		Reason:          MatchEndReasonServerRestart,
		RetentionEndsAt: retentionEndsAt,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
