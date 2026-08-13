// 唯一后台调度器（08 §6.3）：1s tick，重启安全（启动即补扫一次）。
// 职责：
//   - 对局：countdown→playing、局超时平局（与猜测事务共用结算语义）、
//     间歇后开下一局（startsAt = 上局 ended_at + INTERMISSION）、3×N 上限判平、宽限期逾期；
//   - 房间：大厅 TTL 过期关闭、finished 展示期关闭、closed 保留期删除（单条 DELETE CASCADE）。
//
// 锁序纪律（§9.2）：所有触碰局/场行的路径统一 局→场→房间，绝不先锁房间。
package multi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// SweeperConfig sweeper 配置。
type SweeperConfig struct {
	Timing         TimingConfig     // 对局时间常量（Phase 6 由 internal/config 注入）
	EventRetention time.Duration    // closed 到删除的保留时长（MULTI_EVENT_RETENTION）
	Interval       time.Duration    // tick 间隔（默认 1s）
	Broadcaster    EventBroadcaster // 事件入库后广播（先入库后广播，07 §7.2；nil 时空转）
}

// Sweeper 后台调度器（唯一）。
type Sweeper struct {
	pool *pgxpool.Pool
	now  func() time.Time
	rng  *rand.Rand
	cfg  SweeperConfig
}

// NewSweeper 构造 sweeper。Interval 非正数时使用 1s。
func NewSweeper(pool *pgxpool.Pool, cfg SweeperConfig) *Sweeper {
	if cfg.Interval <= 0 {
		cfg.Interval = time.Second
	}
	return &Sweeper{
		pool: pool,
		now:  time.Now,
		rng:  rand.New(rand.NewPCG(uint64(time.Now().UnixNano()), uint64(time.Now().UnixNano())^0x9e3779b97f4a7c15)),
		cfg:  cfg,
	}
}

// Run 阻塞运行 tick 循环；ctx 取消即退出（跟随 server 生命周期）。
func (s *Sweeper) Run(ctx context.Context) {
	s.tick(ctx) // 启动补扫：处理停机期间过期项（重启安全）
	ticker := time.NewTicker(s.cfg.Interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Sweeper) tick(ctx context.Context) {
	if err := s.SweepOnce(ctx); err != nil && ctx.Err() == nil {
		slog.Error("multi sweeper: sweep error", "error", err)
	}
}

// notify 事件事务提交后广播（先入库后广播）。
func (s *Sweeper) notify(roomID string) {
	if s.cfg.Broadcaster != nil {
		s.cfg.Broadcaster.Publish(roomID)
	}
}

// SweepOnce 执行一轮清扫（幂等；供测试与启动补扫）。
func (s *Sweeper) SweepOnce(ctx context.Context) error {
	steps := []func(context.Context) error{
		s.startCountdownRounds,
		s.settleExpiredRelayTurns,
		s.settleTimedOutRounds,
		s.advanceRounds,
		s.expireDisconnectedMembers,
		s.closeExpiredLobbies,
		s.closeExpiredFinishedRooms,
		s.deleteExpiredClosedRooms,
		s.updateStatusMetrics,
	}
	for _, step := range steps {
		if err := step(ctx); err != nil {
			return err
		}
	}
	return nil
}

// updateStatusMetrics 采集时聚合 rooms{status}/members{status}/active_rounds（08 §11.2；失败静默）。
func (s *Sweeper) updateStatusMetrics(ctx context.Context) error {
	q := repo.New(s.pool)
	rooms, err := q.CountRoomStatuses(ctx)
	if err == nil {
		roomCounts := map[string]int64{}
		for _, r := range rooms {
			roomCounts[r.Status] = int64(r.Count)
		}
		DefaultMetrics.SetRoomStatuses(roomCounts)
	}
	members, err := q.CountMemberStatuses(ctx)
	if err == nil {
		memberCounts := map[string]int64{}
		for _, m := range members {
			memberCounts[m.Status] = int64(m.Count)
		}
		DefaultMetrics.SetMemberStatuses(memberCounts)
	}
	if active, err := q.CountActiveRounds(ctx); err == nil {
		DefaultMetrics.SetActiveRounds(int64(active))
	}
	return nil
}

// startCountdownRounds countdown 到点 → playing（round.playing 事件）。
func (s *Sweeper) startCountdownRounds(ctx context.Context) error {
	rounds, err := repo.New(s.pool).ListExpiredRounds(ctx)
	if err != nil {
		return err
	}
	for _, round := range rounds {
		if round.Status != string(RoundStatusCountdown) {
			continue
		}
		if err := s.startRound(ctx, round.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Sweeper) startRound(ctx context.Context, roundID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	locked, err := q.GetRoundForUpdate(ctx, roundID)
	if err != nil {
		return err
	}
	if locked.Status != string(RoundStatusCountdown) || locked.StartsAt.Time.After(s.now()) {
		return tx.Commit(ctx) // 已被其他路径过渡/未到点
	}
	started, err := q.StartRound(ctx, roundID)
	if err != nil || started.Status != string(RoundStatusPlaying) {
		if err != nil {
			return err
		}
		return tx.Commit(ctx)
	}
	match, err := q.GetMatchForUpdate(ctx, locked.MatchID)
	if err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, match.RoomID, EventRoundPlaying, RoundPlayingPayload{
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(locked.RoundIndex),
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(match.RoomID)
	return nil
}

// settleExpiredRelayTurns playing 接力单手超时 → 记空过并切手，必要时结束本局。
func (s *Sweeper) settleExpiredRelayTurns(ctx context.Context) error {
	rounds, err := repo.New(s.pool).ListExpiredRelayTurns(ctx)
	if err != nil {
		return err
	}
	for _, round := range rounds {
		if err := s.settleExpiredRelayTurn(ctx, round.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Sweeper) settleExpiredRelayTurn(ctx context.Context, roundID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	round, err := q.GetRoundForUpdate(ctx, roundID)
	if err != nil {
		return err
	}
	if !RelayTurnExpired(round, s.now()) {
		return tx.Commit(ctx)
	}
	match, err := q.GetMatchForUpdate(ctx, round.MatchID)
	if err != nil {
		return err
	}
	room, err := q.GetRoom(ctx, match.RoomID)
	if err != nil {
		return err
	}
	if MultiplayerMode(room.Mode) != MultiplayerModeRelay {
		return tx.Commit(ctx)
	}

	changed := false
	for RelayTurnExpired(round, s.now()) {
		result, err := SettleExpiredRelayTurnTx(ctx, q, room, round, match, s.now(), s.cfg.Timing)
		if err != nil {
			return err
		}
		changed = true
		round = result.Round
		if result.RoundEnded {
			break
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if changed {
		s.notify(room.ID)
	}
	return nil
}

// settleTimedOutRounds playing 超时 → 平局（round.ended；场级推进由 advanceRounds 完成）。
func (s *Sweeper) settleTimedOutRounds(ctx context.Context) error {
	rounds, err := repo.New(s.pool).ListExpiredRounds(ctx)
	if err != nil {
		return err
	}
	for _, round := range rounds {
		if round.Status != string(RoundStatusPlaying) {
			continue
		}
		if err := s.settleTimeout(ctx, round.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Sweeper) settleTimeout(ctx context.Context, roundID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	round, err := q.GetRoundForUpdate(ctx, roundID)
	if err != nil {
		return err
	}
	if round.Status != string(RoundStatusPlaying) || round.Deadline.Time.After(s.now()) {
		return tx.Commit(ctx) // 已结算/未超时
	}
	match, err := q.GetMatchForUpdate(ctx, round.MatchID)
	if err != nil {
		return err
	}
	if _, err := q.EndRound(ctx, repo.EndRoundParams{
		ID:         round.ID,
		WinnerSlot: pgtype.Int4{},
		EndedAt:    pgtypeTimestamptz(s.now()),
	}); err != nil {
		return err
	}
	nextStarts := s.now().Add(s.cfg.Timing.Intermission)
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
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(match.RoomID)
	return nil
}

// advanceRounds 局间推进：间歇过后开下一局（round_count+1 与 3×N 上限检查在开局事务内）；
// 达上限 → match.ended reason=round_cap（平局）。
func (s *Sweeper) advanceRounds(ctx context.Context) error {
	rows, err := repo.New(s.pool).ListRoundsAwaitingAdvance(ctx, pgtypeInterval(s.cfg.Timing.Intermission))
	if err != nil {
		return err
	}
	for _, row := range rows {
		if err := s.advanceRound(ctx, row.ID, row.RoomID, row.MatchID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Sweeper) advanceRound(ctx context.Context, roundID, roomID, matchID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	round, err := q.GetRoundForUpdate(ctx, roundID)
	if err != nil {
		return err
	}
	if round.Status != string(RoundStatusEnded) {
		return tx.Commit(ctx)
	}
	match, err := q.GetMatchForUpdate(ctx, matchID)
	if err != nil {
		return err
	}
	if match.Status != string(MatchStatusPlaying) {
		return tx.Commit(ctx) // 场已结束（forfeit 等）
	}
	if !round.EndedAt.Time.Add(s.cfg.Timing.Intermission).Before(s.now()) {
		return tx.Commit(ctx)
	}
	room, err := q.GetRoom(ctx, roomID)
	if err != nil {
		return err
	}

	// 开下一局（round_count+1 + 3×N 上限；CreateRound 影响 0 行 = 达上限 → round_cap）
	characters, err := CharactersForVersion(ctx, q, match.CatalogVersion)
	if err != nil {
		return err
	}
	usedRows, err := q.ListUsedAnswersForMatch(ctx, match.ID)
	if err != nil {
		return err
	}
	usedSet := map[string]bool{}
	for _, id := range usedRows {
		usedSet[id] = true
	}
	answer, err := DrawAnswer(AnswerPoolForMatch(match, characters), usedSet, s.rng)
	if err != nil {
		return err
	}
	format := RoomFormat(room.Format)
	maxRounds := MaxRounds(format, s.cfg.Timing.MaxRoundsFactor)
	startsAt := round.EndedAt.Time.Add(s.cfg.Timing.Intermission)
	turnSlot, turnDeadline := InitialTurnParams(room, int(round.RoundIndex+1), startsAt)
	newRound, err := q.CreateRound(ctx, repo.CreateRoundParams{
		ID:           NewID(),
		MatchID:      match.ID,
		MaxRounds:    int32(maxRounds),
		RoundIndex:   round.RoundIndex + 1,
		AnswerID:     answer,
		StartsAt:     pgtypeTimestamptz(startsAt),
		Deadline:     pgtypeTimestamptz(startsAt.Add(s.cfg.Timing.RoundSeconds)),
		TurnSlot:     turnSlot,
		TurnDeadline: turnDeadline,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 已达 3×N 上限且无胜者 → 整场判平（round_cap）
			if err := s.endMatchByCap(ctx, q, match, s.now()); err != nil {
				return err
			}
			if err := tx.Commit(ctx); err != nil {
				return err
			}
			s.notify(roomID)
			return nil
		}
		return err
	}
	roundStarted := RoundStartedPayload{
		MatchIndex: int(match.MatchIndex),
		RoundIndex: int(newRound.RoundIndex),
		StartsAt:   startsAt,
		Deadline:   startsAt.Add(s.cfg.Timing.RoundSeconds),
		MaxGuesses: MaxGuessesForMatch(match),
	}
	members, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return err
	}
	AddRelayRoundStartedFields(&roundStarted, room, members, int(newRound.RoundIndex), startsAt)
	if err := AppendEvent(ctx, q, roomID, EventRoundStarted, roundStarted); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(roomID)
	return nil
}

// endMatchByCap 3×N 上限判平：场次与房间 finished + match.ended(reason=round_cap, draw)。
func (s *Sweeper) endMatchByCap(ctx context.Context, q *repo.Queries, match repo.MultiMatch, now time.Time) error {
	if _, err := q.EndMatch(ctx, repo.EndMatchParams{ID: match.ID, EndedAt: pgtypeTimestamptz(now)}); err != nil {
		return err
	}
	retentionEndsAt := now.Add(s.cfg.Timing.FinishedRetention)
	if _, err := q.UpdateRoomStatus(ctx, repo.UpdateRoomStatusParams{
		ID:        match.RoomID,
		Status:    string(RoomStatusFinished),
		ExpiresAt: pgtypeTimestamptz(retentionEndsAt),
	}); err != nil {
		return err
	}
	return AppendEvent(ctx, q, match.RoomID, EventMatchEnded, MatchEndedEventPayload{
		MatchIndex:      int(match.MatchIndex),
		WinnerSlot:      nil,
		Scores:          ScoresView{Slot1: int(match.ScoreSlot1), Slot2: int(match.ScoreSlot2)},
		Reason:          MatchEndReasonRoundCap,
		RetentionEndsAt: retentionEndsAt,
	})
}

// expireDisconnectedMembers 断线宽限逾期（08 §4.6/§6.2）：
// lobby：房主 → 房间关闭（host_left）、加入者 → 删行释放 slot；
// 对局中：玩家判对方胜（reason=disconnect）+ match.ended；
// finished：成员只标记 left，房间等待 retention 到期；观战者任何状态下均只标记 left。
func (s *Sweeper) expireDisconnectedMembers(ctx context.Context) error {
	members, err := repo.New(s.pool).ListTimedOutMembers(ctx)
	if err != nil {
		return err
	}
	for _, member := range members {
		room, err := repo.New(s.pool).GetRoom(ctx, member.RoomID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				continue // 房间已被清理
			}
			return err
		}
		if IsSpectator(member) {
			if err := s.markDisconnectedMemberLeft(ctx, room, member); err != nil {
				return err
			}
			continue
		}
		switch room.Status {
		case string(RoomStatusPlaying):
			if err := ForfeitMemberMatch(ctx, s.pool, member, MatchEndReasonDisconnect, s.now(), s.cfg.Timing); err != nil {
				return err
			}
		case string(RoomStatusLobby):
			if err := s.expireLobbyMember(ctx, member); err != nil {
				return err
			}
		case string(RoomStatusFinished):
			if err := s.markDisconnectedMemberLeft(ctx, room, member); err != nil {
				return err
			}
		}
	}
	return nil
}

// expireLobbyMember 大厅成员逾期：房主 → 关房（host_left）；加入者 → 删行 + room.updated。
func (s *Sweeper) expireLobbyMember(ctx context.Context, member repo.MultiMember) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	room, err := q.GetRoomForUpdate(ctx, member.RoomID)
	if err != nil {
		return err
	}
	if room.Status != string(RoomStatusLobby) {
		return tx.Commit(ctx)
	}
	if MemberSeat(member) == 1 {
		if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{
			ID:        room.ID,
			ExpiresAt: pgtypeTimestamptz(s.now().Add(s.cfg.EventRetention)),
		}); err != nil {
			return err
		}
		if err := AppendEvent(ctx, q, room.ID, EventRoomClosed, RoomClosedPayload{Reason: RoomCloseReasonHostLeft}); err != nil {
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		s.notify(room.ID)
		return nil
	}
	if err := q.DeleteMember(ctx, member.ID); err != nil {
		return err
	}
	remaining, err := q.ListMembers(ctx, room.ID)
	if err != nil {
		return err
	}
	spectatorCount, err := q.CountSpectators(ctx, room.ID)
	if err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, room.ID, EventRoomUpdated, RoomUpdatedPayload{
		Format:         RoomFormat(room.Format),
		Mode:           MultiplayerMode(room.Mode),
		TurnSeconds:    int(room.TurnSeconds),
		PlayerLimit:    int(room.PlayerLimit),
		Members:        MemberViews(remaining),
		SpectatorCount: int(spectatorCount),
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(room.ID)
	return nil
}

// closeExpiredFinishedRooms finished 展示期到期 → 房间关闭（reason=retention，08 §9.1）。
func (s *Sweeper) closeExpiredFinishedRooms(ctx context.Context) error {
	matches, err := repo.New(s.pool).ListFinishedMatches(ctx)
	if err != nil {
		return err
	}
	for _, match := range matches {
		if err := s.closeFinishedRoomByMatch(ctx, match); err != nil {
			return err
		}
	}
	return nil
}

func (s *Sweeper) closeFinishedRoomByMatch(ctx context.Context, match repo.MultiMatch) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	room, err := q.GetRoomForUpdate(ctx, match.RoomID)
	if err != nil {
		return err
	}
	if room.Status != string(RoomStatusFinished) || !room.ExpiresAt.Time.Before(s.now()) {
		return tx.Commit(ctx)
	}
	if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{
		ID:        room.ID,
		ExpiresAt: pgtypeTimestamptz(s.now().Add(s.cfg.EventRetention)),
	}); err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, room.ID, EventRoomClosed, RoomClosedPayload{Reason: RoomCloseReasonRetention}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(room.ID)
	return nil
}

// markDisconnectedMemberLeft 断线宽限逾期后仅移出成员/观战者；finished 房间继续保留到 retention。
func (s *Sweeper) markDisconnectedMemberLeft(ctx context.Context, room repo.MultiRoom, member repo.MultiMember) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	lockedRoom, err := q.GetRoomForUpdate(ctx, room.ID)
	if err != nil {
		return err
	}
	if lockedRoom.Status == string(RoomStatusClosed) {
		return tx.Commit(ctx)
	}
	if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
		ID:         member.ID,
		Status:     string(MemberStatusLeft),
		GraceUntil: pgtype.Timestamptz{},
	}); err != nil {
		return err
	}
	players, err := q.ListMembers(ctx, lockedRoom.ID)
	if err != nil {
		return err
	}
	spectatorCount, err := q.CountSpectators(ctx, lockedRoom.ID)
	if err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, lockedRoom.ID, EventRoomUpdated, RoomUpdatedPayload{
		Format:         RoomFormat(lockedRoom.Format),
		Mode:           MultiplayerMode(lockedRoom.Mode),
		TurnSeconds:    int(lockedRoom.TurnSeconds),
		PlayerLimit:    int(lockedRoom.PlayerLimit),
		Members:        MemberViews(players),
		SpectatorCount: int(spectatorCount),
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(lockedRoom.ID)
	return nil
}
func (s *Sweeper) closeExpiredLobbies(ctx context.Context) error {
	rooms, err := repo.New(s.pool).ListExpiredLobbyRooms(ctx)
	if err != nil {
		return err
	}
	for _, room := range rooms {
		if err := s.closeLobbyRoom(ctx, room.ID); err != nil {
			return err
		}
	}
	return nil
}

// closeLobbyRoom 锁房间行后校验仍为 lobby 且已过期，再关闭（条件更新兜底并发）。
func (s *Sweeper) closeLobbyRoom(ctx context.Context, roomID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)

	room, err := q.GetRoomForUpdate(ctx, roomID)
	if err != nil {
		return err
	}
	if room.Status != string(RoomStatusLobby) || !room.ExpiresAt.Time.Before(s.now()) {
		return tx.Commit(ctx) // 已被其他路径关闭/未过期
	}

	expires := s.now().Add(s.cfg.EventRetention)
	if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{ID: roomID, ExpiresAt: pgtypeTimestamptz(expires)}); err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, roomID, EventRoomClosed, RoomClosedPayload{Reason: RoomCloseReasonTTL}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.notify(roomID)
	return nil
}

func (s *Sweeper) deleteExpiredClosedRooms(ctx context.Context) error {
	rooms, err := repo.New(s.pool).ListExpiredClosedRooms(ctx)
	if err != nil {
		return err
	}
	for _, room := range rooms {
		if err := repo.New(s.pool).DeleteRoom(ctx, room.ID); err != nil {
			return err
		}
	}
	return nil
}

// AppendEvent 事务内取号并写入 room_event（规范形态 payload）。供 sweeper 与 handler 复用。
func AppendEvent(ctx context.Context, q *repo.Queries, roomID string, eventType EventType, payload any) error {
	DefaultMetrics.IncEvents(string(eventType))
	seq, err := q.IncrementRoomEventSeq(ctx, roomID)
	if err != nil {
		return err
	}
	// 对局/房间裁决事件留痕（不含 payload：规范事件含答案/对手视图，禁入日志防剧透）。
	switch eventType {
	case EventMatchStarted, EventMatchRematch, EventRoundStarted, EventRoundPlaying,
		EventRoundEnded, EventMatchEnded, EventRoomClosed:
		slog.Info("multi lifecycle event", "room_id", roomID, "type", string(eventType), "sequence", seq)
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = q.InsertRoomEvent(ctx, repo.InsertRoomEventParams{
		RoomID:   roomID,
		Sequence: seq,
		Type:     string(eventType),
		Payload:  data,
	})
	return err
}

// pgtypeTimestamptz 构造非空 timestamptz 参数。
func pgtypeTimestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// pgtypeInterval 构造非空 interval 参数。
func pgtypeInterval(d time.Duration) pgtype.Interval {
	return pgtype.Interval{Microseconds: d.Microseconds(), Valid: true}
}
