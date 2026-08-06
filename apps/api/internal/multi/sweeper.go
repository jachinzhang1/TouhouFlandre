// 唯一后台调度器（08 §6.3）：1s tick，重启安全（启动即补扫一次）。
// Phase 2 职责：大厅 TTL 过期关闭（room.closed reason=ttl）、
// closed 保留期到期删除（单条 DELETE FROM multi_room，CASCADE 清整树，§9.1）。
// 对局职责（倒计时/超时/宽限/间歇/展示期）在 Phase 3 追加到同一 goroutine。
package multi

import (
	"context"
	"encoding/json"
	"log"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
)

// SweeperConfig sweeper 配置。
type SweeperConfig struct {
	LobbyTTL       time.Duration // 大厅无人加入过期
	EventRetention time.Duration // closed 到删除的保留时长（MULTI_EVENT_RETENTION）
	Interval       time.Duration // tick 间隔（默认 1s）
}

// Sweeper 后台调度器（唯一；对局职责 Phase 3 扩展）。
type Sweeper struct {
	pool *pgxpool.Pool
	now  func() time.Time
	cfg  SweeperConfig
}

// NewSweeper 构造 sweeper。Interval 非正数时使用 1s。
func NewSweeper(pool *pgxpool.Pool, cfg SweeperConfig) *Sweeper {
	if cfg.Interval <= 0 {
		cfg.Interval = time.Second
	}
	return &Sweeper{pool: pool, now: time.Now, cfg: cfg}
}

// Run 阻塞运行 tick 循环；ctx 取消即退出（跟随 server 生命周期，Phase 4/6 接入完整排空链）。
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
		log.Printf("multi sweeper: sweep error: %v", err)
	}
}

// SweepOnce 执行一轮清扫（幂等；供测试与启动补扫）：
// 1. lobby 过期 → 锁房间行 → closed（expires_at = now + EventRetention）+ room.closed(reason=ttl) 事件；
// 2. closed 过期 → DELETE（CASCADE 清整树）。
func (s *Sweeper) SweepOnce(ctx context.Context) error {
	if err := s.closeExpiredLobbies(ctx); err != nil {
		return err
	}
	return s.deleteExpiredClosedRooms(ctx)
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
		return tx.Commit(ctx) // 已被其他路径关闭/未过期，跳过
	}

	expires := s.now().Add(s.cfg.EventRetention)
	if _, err := q.CloseRoom(ctx, repo.CloseRoomParams{ID: roomID, ExpiresAt: pgtypeTimestamptz(expires)}); err != nil {
		return err
	}
	if err := AppendEvent(ctx, q, roomID, EventRoomClosed, RoomClosedPayload{Reason: RoomCloseReasonTTL}); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
	seq, err := q.IncrementRoomEventSeq(ctx, roomID)
	if err != nil {
		return err
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
