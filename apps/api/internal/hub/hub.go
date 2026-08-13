// Package hub 实现实时通道（08 §8）：连接管理、逐观察者投影扇出、重放、慢消费者与优雅关闭。
// 原则：事件先入库后广播（07 §7.2）；Go 内存只保存活动连接与广播水位，不是房间状态真实来源。
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// Hub 房间事件广播器（单实例，进程内）。
type Hub struct {
	pool      *pgxpool.Pool
	q         *repo.Queries
	grace     time.Duration // 断线宽限（08 §4.7 DISCONNECT_GRACE）
	readLimit int64         // 客户端消息读限（08 §8.5）
	sendQueue int           // 发送队列长度（08 §8.5）

	mu    sync.Mutex
	rooms map[string]*roomHub // roomID → 连接与广播水位
}

// roomHub 单房间状态：每成员单活跃连接（替换语义）+ 房间广播水位。
type roomHub struct {
	lastSeq int64
	conns   map[string]*Conn // memberID → conn
}

// New 构造 hub（grace/readLimit/sendQueue 由 internal/config 注入，08 §4.7/§8.5）。
func New(pool *pgxpool.Pool, grace time.Duration, readLimit int64, sendQueue int) *Hub {
	return &Hub{
		pool:      pool,
		q:         repo.New(pool),
		grace:     grace,
		readLimit: readLimit,
		sendQueue: sendQueue,
		rooms:     map[string]*roomHub{},
	}
}

// ReadLimit 客户端消息读限（handler hello 首帧与 conn 读循环共用）。
func (h *Hub) ReadLimit() int64 { return h.readLimit }

// markDisconnected 连接断开：成员置 disconnected + grace_until + room.updated 事件
// （对端可见离线，08 §4.6；宽限逾期由 sweeper 判负）。
func (h *Hub) markDisconnected(memberID, roomID string) {
	// 替换场景：新连接已注册（同成员），旧连接退出时不得标记断开
	h.mu.Lock()
	rh := h.rooms[roomID]
	if rh != nil && rh.conns[memberID] != nil {
		h.mu.Unlock()
		return
	}
	h.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	room, err := q.GetRoomForUpdate(ctx, roomID)
	if err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	member, err := q.GetMember(ctx, memberID)
	if err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	if member.Status == string(multi.MemberStatusLeft) {
		_ = tx.Commit(ctx)
		return
	}
	if _, err := q.UpdateMemberStatus(ctx, repo.UpdateMemberStatusParams{
		ID:         memberID,
		Status:     string(multi.MemberStatusDisconnected),
		GraceUntil: pgtype.Timestamptz{Time: time.Now().Add(h.grace), Valid: true},
	}); err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	members, err := q.ListMembers(ctx, roomID)
	if err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	spectatorCount, err := q.CountSpectators(ctx, roomID)
	if err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, multi.RoomUpdatedPayload{
		Format:         multi.RoomFormat(room.Format),
		Mode:           multi.MultiplayerMode(room.Mode),
		TurnSeconds:    int(room.TurnSeconds),
		Members:        multi.MemberViews(members),
		SpectatorCount: int(spectatorCount),
	}); err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		slog.Error("hub: mark member disconnected", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	h.Publish(roomID)
}

// Publish 读取房间新事件（lastSeq 之后）并按观察者投影扇出（08 §8.3）。
// 幂等：无连接或无新事件即空转。调用方须在事件事务提交后调用（先入库后广播）。
func (h *Hub) Publish(roomID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	h.mu.Lock()
	rh := h.rooms[roomID]
	if rh == nil {
		h.mu.Unlock()
		return
	}
	last := rh.lastSeq
	conns := make([]*Conn, 0, len(rh.conns))
	for _, c := range rh.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()

	if len(conns) == 0 {
		return
	}
	events, err := h.q.ListEventsAfterSeq(ctx, repo.ListEventsAfterSeqParams{RoomID: roomID, Sequence: last})
	if err != nil {
		slog.Error("hub publish: list events", "room_id", roomID, "error", err)
		return
	}
	if len(events) == 0 {
		return
	}
	members, err := h.q.ListMembers(ctx, roomID)
	if err != nil {
		slog.Error("hub publish: list members", "room_id", roomID, "error", err)
		return
	}
	memberSlotByID := map[string]int32{}
	for _, m := range members {
		memberSlotByID[m.ID] = int32(multi.MemberSeat(m))
	}
	charCache := map[string]map[string]game.Character{}

	for _, event := range events {
		for _, c := range conns {
			if !c.alive() {
				continue
			}
			projected, skip, err := multi.ProjectEvent(ctx, h.q, event, roomID, c.member, memberSlotByID, charCache)
			if err != nil {
				slog.Error("hub publish: project event", "room_id", roomID, "sequence", event.Sequence, "member_id", c.member.ID, "error", err)
				continue
			}
			if skip {
				continue
			}
			frame, err := envelopeFrame(event, projected)
			if err != nil {
				slog.Error("hub publish: marshal event", "room_id", roomID, "sequence", event.Sequence, "error", err)
				continue
			}
			if !c.enqueue(frame) {
				c.closeSlow()
			}
		}
		h.mu.Lock()
		if rh.lastSeq < event.Sequence {
			rh.lastSeq = event.Sequence
		}
		h.mu.Unlock()
	}
}

// Register 注册连接（每成员单活跃连接：替换旧连接并发送 replaced 帧）。
// 返回旧连接（若有，调用方负责关闭）；广播水位校准到房间当前事件序号。
func (h *Hub) Register(c *Conn) *Conn {
	h.mu.Lock()
	defer h.mu.Unlock()
	rh, ok := h.rooms[c.roomID]
	if !ok {
		rh = &roomHub{conns: map[string]*Conn{}}
		h.rooms[c.roomID] = rh
	}
	old := rh.conns[c.member.ID]
	rh.conns[c.member.ID] = c
	multi.DefaultMetrics.AddWsConnections(1)
	if c.lastSequence > 0 {
		multi.DefaultMetrics.IncReconnects()
	}
	slog.Info("ws: member connected", "room_id", c.roomID, "member_id", c.member.ID, "reconnect", c.lastSequence > 0)
	// 广播水位推进到当前事件序号（新连接经 hello 重放补齐自身缺口；发布在后的新事件才会推给它）
	if current := h.roomEventSeq(c.roomID); current > rh.lastSeq {
		rh.lastSeq = current
	}
	return old
}

// Unregister 移除连接（连接关闭时调用；若已被替换则不动）。
func (h *Hub) Unregister(c *Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if rh, ok := h.rooms[c.roomID]; ok {
		if rh.conns[c.member.ID] == c {
			delete(rh.conns, c.member.ID)
			multi.DefaultMetrics.AddWsConnections(-1)
		}
		if len(rh.conns) == 0 {
			delete(h.rooms, c.roomID)
		}
	}
}

// CloseAll 优雅关闭全部连接（1012 Service Restart，08 §11.2 排空顺序第 2 步）。
func (h *Hub) CloseAll() {
	h.mu.Lock()
	conns := []*Conn{}
	for _, rh := range h.rooms {
		for _, c := range rh.conns {
			conns = append(conns, c)
		}
	}
	h.mu.Unlock()
	for _, c := range conns {
		c.closeServiceRestart()
	}
}

// roomEventSeq 读取房间当前事件水位（注册时校准；失败保守返回 0）。
func (h *Hub) roomEventSeq(roomID string) int64 {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	room, err := h.q.GetRoom(ctx, roomID)
	if err != nil {
		return 0
	}
	return room.EventSeq
}

// envelopeFrame 组装事件信封（08 §8.2）。
func envelopeFrame(event repo.RoomEvent, projected multi.ProjectedEvent) ([]byte, error) {
	payloadBytes, err := json.Marshal(projected.Payload)
	if err != nil {
		return nil, err
	}
	return json.Marshal(multi.Envelope{
		Type:       projected.Type,
		EventID:    strconv.FormatInt(event.ID, 10),
		RoomID:     event.RoomID,
		Sequence:   event.Sequence,
		OccurredAt: event.OccurredAt.Time,
		Payload:    json.RawMessage(payloadBytes),
	})
}
