// 连接生命周期（08 §8.1/§8.4/§8.5）：读写循环、心跳、慢消费者与替换语义。
package hub

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"sync/atomic"
	"time"

	"github.com/coder/websocket"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// SendQueueSize 发送队列上限（08 §8.5：64）。
const SendQueueSize = 64

// WriteTimeout 写超时（08 §8.5：10s）。
const WriteTimeout = 10 * time.Second

// ReadTimeout 读超时（08 §8.5：60s，心跳 pong 维持）。
const ReadTimeout = 60 * time.Second

// HeartbeatInterval 服务端心跳间隔（客户端 pong 维持读 deadline）。
const HeartbeatInterval = 30 * time.Second

// Conn 单成员连接。
type Conn struct {
	hub              *Hub
	ws               *websocket.Conn
	roomID           string
	member           repo.MultiMember
	lastGameSequence int64 // hello 携带的客户端已确认游戏水位（重放起点）
	barrierMu        sync.Mutex
	buffering        bool
	buffered         map[int64][]byte

	send           chan outboundFrame
	closeOnce      sync.Once
	closed         chan struct{}
	aliveMu        sync.Mutex
	isAlive        bool
	invalidated    atomic.Bool // role/seat 已变化，停止使用连接建立时的缓存身份
	skipDisconnect atomic.Bool // 服务端身份失效关闭不应写入 disconnected

	reasonMu    sync.Mutex
	closeReason string // 断开原因（cleanup 统一记录；首个设置者生效）
}

type outboundFrame struct {
	data       []byte
	closeAfter bool
}

// NewConn 构造连接（hello 鉴权由调用方完成；Serve 阻塞运行）。发送队列长度取自 hub 配置。
func NewConn(hub *Hub, ws *websocket.Conn, roomID string, member repo.MultiMember, lastGameSequence int64) *Conn {
	queue := hub.sendQueue
	if queue <= 0 {
		queue = SendQueueSize
	}
	return &Conn{
		hub:              hub,
		ws:               ws,
		roomID:           roomID,
		member:           member,
		lastGameSequence: lastGameSequence,
		buffering:        true,
		buffered:         make(map[int64][]byte),
		send:             make(chan outboundFrame, queue),
		closed:           make(chan struct{}),
		isAlive:          true,
	}
}

// setCloseReason 记录断开原因（first-wins：具体路径先设置，通用关闭不覆盖）。
func (c *Conn) setCloseReason(reason string) {
	c.reasonMu.Lock()
	if c.closeReason == "" {
		c.closeReason = reason
	}
	c.reasonMu.Unlock()
}

// closeReasonValue 读取断开原因。
func (c *Conn) closeReasonValue() string {
	c.reasonMu.Lock()
	defer c.reasonMu.Unlock()
	return c.closeReason
}

// alive 连接是否仍可推送。
func (c *Conn) alive() bool {
	c.aliveMu.Lock()
	defer c.aliveMu.Unlock()
	return c.isAlive
}

// enqueue 非阻塞入队；队列写满返回 false（慢消费者，08 §8.5）。
func (c *Conn) enqueue(frame []byte) bool {
	select {
	case c.send <- outboundFrame{data: frame}:
		return true
	default:
		return false
	}
}

// deliverGameFrame buffers room publications until replay and barrier draining finish.
func (c *Conn) deliverGameFrame(sequence int64, frame []byte) bool {
	c.barrierMu.Lock()
	defer c.barrierMu.Unlock()
	if c.invalidated.Load() {
		return true
	}
	if c.buffering {
		if _, exists := c.buffered[sequence]; !exists {
			c.buffered[sequence] = frame
		}
		return true
	}
	return c.enqueue(frame)
}

// Serve 阻塞运行连接：注册（替换旧连接）→ hello-ok → 重放 → sync.complete → 实时流。
func (c *Conn) Serve() {
	defer c.cleanup()

	// 替换语义：注册时若已有同成员连接，旧连接收 replaced 帧后关闭（08 §8.1）
	if old := c.hub.Register(c); old != nil {
		old.sendReplacedAndClose()
	}
	c.hub.runSyncHook("registered")
	targetGameSequence := c.hub.roomEventSeq(c.roomID)
	c.hub.runSyncHook("watermark_captured")
	// Bring the room publisher watermark up to date after registration. The new
	// connection remains buffering, so overlap with replay is deduplicated below.
	c.hub.Publish(c.roomID)
	if err := c.writeText(multi.HelloOkMessage{Type: "hello-ok", RoomID: c.roomID, TargetGameSequence: targetGameSequence}); err != nil {
		c.setCloseReason("hello_ok_failed")
		slog.Error("ws: hello-ok write failed", "room_id", c.roomID, "member_id", c.member.ID, "error", err)
		return
	}
	deliveredGameSequence, err := c.replay(targetGameSequence)
	if err != nil {
		c.setCloseReason("replay_failed")
		slog.Error("ws: replay failed", "room_id", c.roomID, "member_id", c.member.ID, "error", err)
		return
	}
	c.hub.runSyncHook("replay_complete")
	if !c.finishBarrier(deliveredGameSequence) {
		c.closeSlow()
		return
	}
	c.hub.runSyncHook("live")

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		c.writeLoop()
	}()
	c.readLoop()
	c.closeQuietly()
	wg.Wait()
}

// replay 从 lastGameSequence+1 重放缺口；每个 sequence 投递业务事件或 cursor。
func (c *Conn) replay(targetGameSequence int64) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	events, err := c.hub.q.ListEventsAfterSeq(ctx, repo.ListEventsAfterSeqParams{
		RoomID: c.roomID, Sequence: c.lastGameSequence,
	})
	if err != nil {
		return c.lastGameSequence, err
	}
	if len(events) == 0 {
		return c.lastGameSequence, nil
	}
	members, err := c.hub.q.ListMembers(ctx, c.roomID)
	if err != nil {
		return c.lastGameSequence, err
	}
	memberSlotByID := map[string]int32{}
	for _, m := range members {
		memberSlotByID[m.ID] = int32(multi.MemberSeat(m))
	}
	charCache := map[string]map[string]game.Character{}
	for _, event := range events {
		if event.Sequence > targetGameSequence {
			break
		}
		projected, skip, err := multi.ProjectEvent(ctx, c.hub.q, c.hub.projectionSecret, event, c.roomID, c.member, memberSlotByID, charCache)
		if err != nil {
			return c.lastGameSequence, err
		}
		frame, err := gameFrame(event, projected, skip)
		if err != nil {
			return c.lastGameSequence, err
		}
		delivered, invalidated := c.deliverReplayFrame(event.Sequence, frame)
		if invalidated {
			return c.lastGameSequence, nil
		}
		if !delivered {
			c.closeSlow()
			return event.Sequence, nil
		}
		if event.Sequence > c.lastGameSequence {
			c.lastGameSequence = event.Sequence
		}
	}
	return c.lastGameSequence, nil
}

func (c *Conn) deliverReplayFrame(sequence int64, frame []byte) (delivered bool, invalidated bool) {
	c.barrierMu.Lock()
	defer c.barrierMu.Unlock()
	if c.invalidated.Load() {
		return false, true
	}
	if !c.enqueue(frame) {
		return false, false
	}
	delete(c.buffered, sequence)
	return true, false
}

// finishBarrier drains buffered publications in sequence order while new publications
// keep joining the same map. With the barrier lock held, enqueue sync.complete and flip
// live atomically so all later publications can only follow the completion frame.
func (c *Conn) finishBarrier(deliveredGameSequence int64) bool {
	c.barrierMu.Lock()
	defer c.barrierMu.Unlock()
	if c.invalidated.Load() {
		clear(c.buffered)
		return true
	}

	for {
		frame, ok := c.buffered[deliveredGameSequence+1]
		if !ok {
			break
		}
		if !c.enqueue(frame) {
			return false
		}
		deliveredGameSequence++
		delete(c.buffered, deliveredGameSequence)
	}
	for sequence := range c.buffered {
		if sequence <= deliveredGameSequence {
			delete(c.buffered, sequence)
		}
	}
	complete, err := json.Marshal(multi.SyncCompleteMessage{Type: "sync.complete", GameSequence: deliveredGameSequence})
	if err != nil || !c.enqueue(complete) {
		return false
	}
	c.buffering = false
	return true
}

// writeLoop 推送队列帧并定期心跳。
func (c *Conn) writeLoop() {
	heartbeat := time.NewTicker(HeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case frame, ok := <-c.send:
			if !ok {
				return
			}
			ctx, cancel := context.WithTimeout(context.Background(), WriteTimeout)
			err := c.ws.Write(ctx, websocket.MessageText, frame.data)
			cancel()
			if err != nil {
				c.setCloseReason("write_error")
				c.closeQuietly()
				return
			}
			if frame.closeAfter {
				c.closeQuietly()
				return
			}
		case <-heartbeat.C:
			ctx, cancel := context.WithTimeout(context.Background(), WriteTimeout)
			err := c.ws.Ping(ctx)
			cancel()
			if err != nil {
				c.setCloseReason("heartbeat_dead")
				c.closeQuietly()
				return
			}
		case <-c.closed:
			return
		}
	}
}

// readLoop 读取客户端消息（仅 hello 之后的 ack）。
// 死亡连接检测走心跳 Ping（writeLoop 30s 间隔）；连接关闭会解除 Read 阻塞。
func (c *Conn) readLoop() {
	c.ws.SetReadLimit(c.hub.readLimit)
	for {
		_, data, err := c.ws.Read(context.Background())
		if err != nil {
			return
		}
		var msg struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(data, &msg); err != nil || msg.Type != "ack" {
			c.setCloseReason("bad_message") // 未知客户端消息 → 关闭（协议最小集）
			c.closeQuietly()
			return
		}
	}
}

// writeText 直接写一帧（hello-ok / replaced）。
func (c *Conn) writeText(v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), WriteTimeout)
	defer cancel()
	return c.ws.Write(ctx, websocket.MessageText, data)
}

// sendReplacedAndClose 被替换：replaced 帧入队（FIFO，排在未写队列之后）；
// writeLoop 写出该帧（队列随之排空）后自行关闭连接（08 §8.1「旧连接入队 replaced 关闭帧后断开」）。
func (c *Conn) sendReplacedAndClose() {
	c.setCloseReason("replaced")
	frame, _ := json.Marshal(multi.ReplacedMessage{Type: "replaced", Reason: "replaced"})
	select {
	case c.send <- outboundFrame{data: frame, closeAfter: true}:
	default:
		c.closeQuietly()
	}
}

// sendMemberChangedAndClose 使连接建立时缓存的 role/seat 立即失效。该关闭由服务端
// 身份转换触发，不应把仍在线的 member 误记为 disconnected。
func (c *Conn) sendMemberChangedAndClose() {
	if !c.invalidated.CompareAndSwap(false, true) {
		return
	}
	c.setCloseReason("member_changed")
	c.skipDisconnect.Store(true)
	c.aliveMu.Lock()
	c.isAlive = false
	c.aliveMu.Unlock()

	c.barrierMu.Lock()
	clear(c.buffered)
	frame, _ := json.Marshal(multi.ReplacedMessage{Type: "replaced", Reason: "member_changed"})
	select {
	case c.send <- outboundFrame{data: frame, closeAfter: true}:
	default:
		c.closeQuietly()
	}
	c.barrierMu.Unlock()
}

// closeSlow 慢消费者：发送队列写满 → 1013（08 §8.5），不阻塞房间广播。
func (c *Conn) closeSlow() {
	c.setCloseReason("slow_consumer")
	c.closeWith(websocket.StatusTryAgainLater, "slow consumer")
}

// closeServiceRestart 优雅排空：1012（08 §11.2）。
func (c *Conn) closeServiceRestart() {
	c.setCloseReason("server_restart")
	c.closeWith(websocket.StatusServiceRestart, "server restart")
}

func (c *Conn) closeWith(status websocket.StatusCode, reason string) {
	c.setCloseReason(reason)
	c.closeOnce.Do(func() {
		c.aliveMu.Lock()
		c.isAlive = false
		c.aliveMu.Unlock()
		_ = c.ws.Close(status, reason)
		close(c.closed)
	})
}

// closeQuietly 不指定状态的关闭（读错误路径；原因已由调用路径先行设置）。
func (c *Conn) closeQuietly() {
	c.setCloseReason("peer_closed")
	c.closeOnce.Do(func() {
		c.aliveMu.Lock()
		c.isAlive = false
		c.aliveMu.Unlock()
		_ = c.ws.CloseNow()
		close(c.closed)
	})
}

// cleanup 连接退出：注销 + 成员置 disconnected（宽限计时由 sweeper 判定，08 §4.6）。
func (c *Conn) cleanup() {
	c.closeQuietly()
	c.hub.Unregister(c)
	if !c.skipDisconnect.Load() {
		c.hub.markDisconnected(c.member.ID, c.roomID)
	}
	reason := c.closeReasonValue()
	if reason == "" {
		reason = "unknown"
	}
	level := slog.LevelInfo
	switch reason {
	case "slow_consumer", "heartbeat_dead", "write_error", "bad_message", "hello_ok_failed", "replay_failed":
		level = slog.LevelWarn
	}
	slog.Log(context.Background(), level, "ws: connection closed",
		"room_id", c.roomID, "member_id", c.member.ID, "reason", reason)
}
