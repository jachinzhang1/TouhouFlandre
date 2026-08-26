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
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
)

// Hub 房间事件广播器（单实例，进程内）。
type Hub struct {
	pool             *pgxpool.Pool
	q                *repo.Queries
	grace            time.Duration // 断线宽限（08 §4.7 DISCONNECT_GRACE）
	readLimit        int64         // 客户端消息读限（08 §8.5）
	sendQueue        int           // 发送队列长度（08 §8.5）
	projectionSecret []byte        // 对手匿名矩阵 HMAC 密钥
	chatRetention    time.Duration
	chatCursor       *multi.ChatCursorCodec
	modeRegistry     *core.Registry

	mu    sync.Mutex
	rooms map[string]*roomHub // roomID → 连接与广播水位

	syncHookMu sync.Mutex
	syncHook   func(stage string)
}

// roomHub 单房间状态：每成员单活跃连接（替换语义）+ 房间广播水位。
type roomHub struct {
	publishMu        sync.Mutex
	chatPublishMu    sync.Mutex
	lastSeq          int64
	lastChatPosition int64
	chatInitialized  bool
	conns            map[string]*Conn // memberID → conn
}

// New 构造 hub（grace/readLimit/sendQueue 由 internal/config 注入，08 §4.7/§8.5）。
func New(pool *pgxpool.Pool, grace time.Duration, readLimit int64, sendQueue int, projectionSecret []byte, chatRetention time.Duration, chatCursorSecret []byte, registries ...*core.Registry) *Hub {
	registry := assembly.MustProduction()
	if len(registries) > 0 && registries[0] != nil {
		registry = registries[0]
	}
	return &Hub{
		pool:             pool,
		q:                repo.New(pool),
		grace:            grace,
		readLimit:        readLimit,
		sendQueue:        sendQueue,
		projectionSecret: append([]byte(nil), projectionSecret...),
		chatRetention:    chatRetention,
		chatCursor:       multi.NewChatCursorCodec(chatCursorSecret),
		modeRegistry:     registry,
		rooms:            map[string]*roomHub{},
	}
}

// PublishChat 把已提交的独立 chat position 按当前观察者角色投影到连接。
func (h *Hub) PublishChat(roomID string) {
	h.mu.Lock()
	rh := h.rooms[roomID]
	h.mu.Unlock()
	if rh == nil {
		return
	}
	rh.chatPublishMu.Lock()
	defer rh.chatPublishMu.Unlock()

	h.mu.Lock()
	if !rh.chatInitialized {
		h.mu.Unlock()
		return
	}
	last := rh.lastChatPosition
	conns := make([]*Conn, 0, len(rh.conns))
	for _, c := range rh.conns {
		conns = append(conns, c)
	}
	h.mu.Unlock()
	if len(conns) == 0 {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	room, err := h.q.GetRoom(ctx, roomID)
	if err != nil {
		multi.DefaultMetrics.IncChatProjectionFailure("realtime")
		return
	}
	participants, err := h.q.ListParticipants(ctx, roomID)
	if err != nil {
		multi.DefaultMetrics.IncChatProjectionFailure("realtime")
		return
	}
	participantByID := make(map[string]repo.MultiMember, len(participants))
	for _, participant := range participants {
		participantByID[participant.ID] = participant
	}
	cutoff := pgtype.Timestamptz{Time: time.Now().Add(-h.chatRetention), Valid: true}
	for last < room.ChatSeq {
		rows, err := h.q.ListChatMessagesAfter(ctx, repo.ListChatMessagesAfterParams{
			RoomID: roomID, AfterPosition: last, HighPosition: room.ChatSeq, Cutoff: cutoff,
		})
		if err != nil {
			multi.DefaultMetrics.IncChatProjectionFailure("realtime")
			return
		}
		if len(rows) == 0 {
			last = room.ChatSeq
			break
		}
		for _, message := range rows {
			for _, c := range conns {
				if !c.chatSubscribed || !c.alive() {
					continue
				}
				current, exists := participantByID[c.member.ID]
				if !exists || current.Role != c.member.Role {
					c.sendMemberChangedAndClose()
					continue
				}
				visible := multi.CanViewChatChannel(current.Role, message.Channel)
				var frame []byte
				if visible {
					frame, err = h.chatFrame(message, room)
					if err != nil {
						multi.DefaultMetrics.IncChatProjectionFailure("realtime")
						c.setCloseReason("chat_projection_error")
						c.closeQuietly()
						continue
					}
				}
				if !c.deliverChatFrame(message.Position, frame, visible) {
					c.closeSlow()
				}
			}
			last = message.Position
		}
	}
	h.mu.Lock()
	if rh.lastChatPosition < last {
		rh.lastChatPosition = last
	}
	h.mu.Unlock()
}

func (h *Hub) chatFrame(message repo.MultiChatMessage, room repo.MultiRoom) ([]byte, error) {
	frame := multi.ChatMessageFrame{
		Type: "chat.message", MessageID: message.ID, RoomID: message.RoomID,
		SenderMemberID: message.SenderMemberID, SenderDisplayName: message.SenderDisplayName,
		SenderRole: multi.ChatSenderRole(message.SenderRole), Kind: multi.ChatKind(message.Kind),
		Content: message.Content, Channel: multi.ChatChannel(message.Channel),
		Cursor:    h.chatCursor.Encode(room.ID, room.CreatedAt.Time, message.Position, multi.ChatCursorAfter),
		CreatedAt: message.CreatedAt.Time,
	}
	if message.SenderSeat.Valid {
		seat := int(message.SenderSeat.Int32)
		frame.SenderSeat = &seat
	}
	return json.Marshal(frame)
}

// ProjectionSecret 返回快照处理器应复用的投影密钥副本。
func (h *Hub) ProjectionSecret() []byte {
	return append([]byte(nil), h.projectionSecret...)
}

// ReadLimit 客户端消息读限（handler hello 首帧与 conn 读循环共用）。
func (h *Hub) ReadLimit() int64 { return h.readLimit }

// SetSyncTestHook installs a deterministic integration-test hook for v2 barrier stages.
// Production callers must leave it nil.
func (h *Hub) SetSyncTestHook(hook func(stage string)) {
	h.syncHookMu.Lock()
	h.syncHook = hook
	h.syncHookMu.Unlock()
}

func (h *Hub) runSyncHook(stage string) {
	h.syncHookMu.Lock()
	hook := h.syncHook
	h.syncHookMu.Unlock()
	if hook != nil {
		hook(stage)
	}
}

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
	relayConfig, err := multi.RelayRoomConfigForRoom(ctx, q, room)
	if err != nil {
		slog.Error("hub: load relay room config", "member_id", memberID, "room_id", roomID, "error", err)
		return
	}
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, multi.NewRoomUpdatedPayload(room, members, int(spectatorCount), multi.RelayRoomProjectionConfig(relayConfig.EliminationEnabled))); err != nil {
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
	h.mu.Unlock()
	if rh == nil {
		return
	}
	rh.publishMu.Lock()
	defer rh.publishMu.Unlock()

	h.mu.Lock()
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
	if err := h.validateModeHistory(ctx, roomID); err != nil {
		slog.Error("hub publish: resolve mode history", "room_id", roomID, "error", err)
		for _, c := range conns {
			c.setCloseReason("projection_error")
			c.closeQuietly()
		}
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
	participants, err := h.q.ListParticipants(ctx, roomID)
	if err != nil {
		slog.Error("hub publish: list participants", "room_id", roomID, "error", err)
		return
	}
	participantByID := make(map[string]repo.MultiMember, len(participants))
	for _, participant := range participants {
		participantByID[participant.ID] = participant
	}
	charCache := map[string]map[string]game.Character{}

	for _, event := range events {
		for _, c := range conns {
			if !c.alive() {
				continue
			}
			current, exists := participantByID[c.member.ID]
			if !exists || current.Role != c.member.Role {
				c.sendMemberChangedAndClose()
				continue
			}
			// seat 是展示顺序而非身份或能力。大厅降容会保留 memberId/role 并压紧 seat，
			// 因此同一连接继续有效，但事件投影必须使用数据库中的最新成员视图。
			projected, skip, err := multi.ProjectEvent(ctx, h.q, h.projectionSecret, event, roomID, current, memberSlotByID, charCache)
			if err != nil {
				slog.Error("hub publish: project event", "room_id", roomID, "sequence", event.Sequence, "member_id", c.member.ID, "error", err)
				c.setCloseReason("projection_error")
				c.closeQuietly()
				continue
			}
			frame, err := gameFrame(event, projected, skip)
			if err != nil {
				slog.Error("hub publish: marshal event", "room_id", roomID, "sequence", event.Sequence, "error", err)
				c.setCloseReason("projection_error")
				c.closeQuietly()
				continue
			}
			if !c.deliverGameFrame(event.Sequence, frame) {
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

// InvalidateMember 使指定 member 的旧连接停止使用握手时缓存的 role/seat，并以
// member_changed 控制帧要求客户端使用同一 token 重新鉴权连接。
func (h *Hub) InvalidateMember(roomID, memberID string) {
	h.mu.Lock()
	var conn *Conn
	if room := h.rooms[roomID]; room != nil {
		conn = room.conns[memberID]
	}
	h.mu.Unlock()
	if conn != nil {
		conn.sendMemberChangedAndClose()
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
	if c.chatSubscribed && !rh.chatInitialized {
		rh.lastChatPosition = c.lastChatPosition
		rh.chatInitialized = true
	}
	multi.DefaultMetrics.AddWsConnections(1)
	if c.lastGameSequence > 0 {
		multi.DefaultMetrics.IncReconnects()
	}
	slog.Info("ws: member connected", "room_id", c.roomID, "member_id", c.member.ID, "reconnect", c.lastGameSequence > 0)
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

func (h *Hub) roomState(roomID string) (repo.MultiRoom, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return h.q.GetRoom(ctx, roomID)
}

// gameFrame 为每个持久化 sequence 组装业务事件或不泄露业务类型/payload 的 cursor。
func gameFrame(event repo.RoomEvent, projected multi.ProjectedEvent, cursor bool) ([]byte, error) {
	if cursor {
		return json.Marshal(multi.CursorEnvelope{
			Type:       "room.cursor",
			EventID:    strconv.FormatInt(event.ID, 10),
			RoomID:     event.RoomID,
			Sequence:   event.Sequence,
			OccurredAt: event.OccurredAt.Time,
		})
	}
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
