// 实时通道集成测试（Phase 4）：升级校验、hello 鉴权、重放、替换、广播、断线状态。
package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

const (
	wsTestOrigin  = "http://localhost:5173"
	wsTestProto   = "touhouflandre-multi.v1"
	wsInvalidOrig = "http://evil.example.com"
)

// wsURL 由 fast server http 地址推导 ws 地址。
func wsURL(roomID string) string {
	return "ws" + strings.TrimPrefix(fastBaseURL, "http") + "/api/rooms/" + roomID + "/ws"
}

// wsDial 建立 WS（可指定 Origin/子协议；nil opts 用合法默认）。
func wsDial(t *testing.T, roomID, token string, lastSeq int64, opts *websocket.DialOptions) *websocket.Conn {
	t.Helper()
	if opts == nil {
		opts = &websocket.DialOptions{
			HTTPHeader:   http.Header{"Origin": []string{wsTestOrigin}},
			Subprotocols: []string{wsTestProto},
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL(roomID), opts)
	if err != nil {
		t.Fatalf("ws dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	// hello 首帧
	hello, _ := json.Marshal(multi.HelloMessage{Type: "hello", Token: token, LastSequence: lastSeq})
	writeCtx, wCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer wCancel()
	if err := conn.Write(writeCtx, websocket.MessageText, hello); err != nil {
		t.Fatalf("ws hello: %v", err)
	}
	return conn
}

// wsRead 读取一帧并解码 JSON。
func wsRead(t *testing.T, conn *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := conn.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("ws decode: %v (%s)", err, data)
	}
	return msg
}

// drainUntilType 读取帧直到出现目标类型（容忍多余帧；max 为读取上限）。
func drainUntilType(t *testing.T, conn *websocket.Conn, target string, max int) {
	t.Helper()
	for i := 0; i < max; i++ {
		msg := wsRead(t, conn)
		if msg["type"] == target {
			return
		}
	}
	t.Fatalf("drain %s: 未见 %s（已读 %d 帧）", target, target, max)
}

func TestMultiWSConnectAndReplay(t *testing.T) {
	fixture := createMatchFixture(t)

	conn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	first := wsRead(t, conn)
	if first["type"] != "hello-ok" {
		t.Fatalf("first frame = %v, want hello-ok", first)
	}
	next, _ := first["nextSequence"].(float64)
	if next < 1 {
		t.Fatalf("nextSequence = %v, want >= 1", next)
	}
	// 重放：连接/创建/加入的 room.updated 事件
	types := []string{}
	for i := 0; i < 3; i++ {
		msg := wsRead(t, conn)
		types = append(types, msg["type"].(string))
	}
	for _, typ := range types {
		if typ != "room.updated" {
			t.Fatalf("replay events = %v", types)
		}
	}

	// 实时广播：REST ready → WS 收到 room.updated
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}
	live := wsRead(t, conn)
	if live["type"] != "room.updated" {
		t.Fatalf("live event = %v, want room.updated", live)
	}
}

func TestMultiWSUpgradeRejections(t *testing.T) {
	fixture := createMatchFixture(t)

	// Origin 不在 WEB_ORIGINS → 拒绝升级
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := websocket.Dial(ctx, wsURL(fixture.roomID), &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{wsInvalidOrig}},
		Subprotocols: []string{wsTestProto},
	})
	if err == nil {
		t.Fatal("wrong origin dial should fail")
	}

	// 未请求子协议：升级成功但服务端按协议版本协商拒绝（读侧收到策略违规关闭）
	conn, _, err := websocket.Dial(ctx, wsURL(fixture.roomID), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{wsTestOrigin}},
	})
	if err != nil {
		t.Fatalf("dial without subprotocol should upgrade, then close: %v", err)
	}
	defer conn.CloseNow()
	if _, _, err := conn.Read(ctx); err == nil {
		t.Fatal("missing subprotocol should be closed by server")
	}
}

func TestMultiWSFirstFrameMustBeHello(t *testing.T) {
	fixture := createMatchFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL(fixture.roomID), &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{wsTestOrigin}},
		Subprotocols: []string{wsTestProto},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	// 首帧 ack → 服务端以策略违规关闭
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"ack","lastSequence":0}`)); err != nil {
		t.Fatal(err)
	}
	_, _, err = conn.Read(ctx)
	if err == nil {
		t.Fatal("expected close after non-hello first frame")
	}
}

func TestMultiWSBadToken(t *testing.T) {
	fixture := createMatchFixture(t)
	conn := wsDial(t, fixture.roomID, "forged-token", 0, nil)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("expected close after bad token hello")
	}
}

func TestMultiWSReplaced(t *testing.T) {
	fixture := createMatchFixture(t)

	first := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	if msg := wsRead(t, first); msg["type"] != "hello-ok" {
		t.Fatalf("first conn frame = %v", msg)
	}
	// 第二连接替换：旧连接收到 replaced 帧后关闭
	second := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	if msg := wsRead(t, second); msg["type"] != "hello-ok" {
		t.Fatalf("second conn frame = %v", msg)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	// 旧连接按 FIFO 收到已入队事件，随后是 replaced 帧（排空读取直到 replaced）
	sawReplaced := false
	for !sawReplaced {
		_, data, err := first.Read(ctx)
		if err != nil {
			t.Fatalf("old conn should receive replaced frame before close: %v", err)
		}
		var frame map[string]any
		if err := json.Unmarshal(data, &frame); err != nil {
			t.Fatalf("decode: %v", err)
		}
		if frame["type"] == "replaced" {
			sawReplaced = true
		}
	}
	// 旧连接随后关闭
	if _, _, err := first.Read(ctx); err == nil {
		t.Fatal("old conn should be closed after replaced")
	}
	// 新连接仍存活（事件仍可达）
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}
	live := wsRead(t, second)
	if live["type"] != "room.updated" {
		t.Fatalf("second conn live event = %v", live)
	}
}

func TestMultiWSGuessBroadcast(t *testing.T) {
	fixture := createMatchFixture(t)

	hostConn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	joinerConn := wsDial(t, fixture.roomID, fixture.joinerToken, 0, nil)
	// 双方 ready → 对局开始；各自推进到 round.playing（容忍重放/连接事件的帧数差异）
	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready: %d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	drainUntilType(t, hostConn, "round.playing", 12)
	drainUntilType(t, joinerConn, "round.playing", 12)

	// host 猜中 → joiner 收到 round.opponent.guess（匿名投影）+ round.ended
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "ws-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("guess: %d %s", resp.StatusCode, payload)
	}
	gotGuess, gotEnded := false, false
	for i := 0; i < 2; i++ { // 恰好两帧：round.opponent.guess + round.ended（同事务、顺序广播）
		msg := wsRead(t, joinerConn)
		switch msg["type"] {
		case "round.opponent.guess":
			gotGuess = true
			p, _ := msg["payload"].(map[string]any)
			statuses, _ := p["statuses"].([]any)
			if len(statuses) != 6 {
				t.Fatalf("opponent guess statuses = %d", len(statuses))
			}
			if _, leaked := p["memberSlot"]; leaked {
				t.Fatalf("guess payload leaks memberSlot: %v", p)
			}
		case "round.ended":
			gotEnded = true
			p, _ := msg["payload"].(map[string]any)
			if p["viewerResult"] != "loss" {
				t.Fatalf("joiner round.ended viewerResult = %v, want loss", p["viewerResult"])
			}
		}
	}
	if !gotGuess || !gotEnded {
		t.Fatalf("joiner missed events: guess=%v ended=%v", gotGuess, gotEnded)
	}
	// host 视角：自己的猜测事件被过滤，只收到 round.ended
	msg := wsRead(t, hostConn)
	if msg["type"] == "round.opponent.guess" {
		t.Fatalf("host received own guess event: %v", msg)
	}
	if msg["type"] != "round.ended" {
		t.Fatalf("host frame = %v, want round.ended", msg["type"])
	}
}

func TestMultiWSDisconnectMarksMember(t *testing.T) {
	fixture := createMatchFixture(t)
	conn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	_ = wsRead(t, conn) // hello-ok
	_ = conn.CloseNow()

	// 连接关闭 → 成员置 disconnected（宽限计时）
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var status string
		if err := pool.QueryRow(ctx, "SELECT status FROM multi_member WHERE room_id = $1 AND seat = 1", fixture.roomID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status == "disconnected" {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("member not marked disconnected after ws close")
}

func TestMultiWSReplayAfterReconnect(t *testing.T) {
	fixture := createMatchFixture(t)

	first := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	for i := 0; i < 3; i++ {
		_ = wsRead(t, first) // hello-ok + room.updated（连接/创建/加入）
	}
	// 记录水位后断开（hello-ok 后 3 条事件）
	var lastSeq float64 = 3
	_ = first.CloseNow()

	// 断开期间发生事件（ready）
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}

	// 重连携带 lastSequence → 只重放缺口事件（room.updated）
	second := wsDial(t, fixture.roomID, fixture.hostToken, int64(lastSeq), nil)
	msg := wsRead(t, second)
	if msg["type"] != "hello-ok" {
		t.Fatalf("reconnect first frame = %v", msg)
	}
	replay := wsRead(t, second)
	if replay["type"] != "room.updated" {
		t.Fatalf("replay event = %v, want room.updated", replay["type"])
	}
	if seq, _ := replay["sequence"].(float64); seq <= lastSeq {
		t.Fatalf("replayed sequence %v must be > %v", seq, lastSeq)
	}
}
