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

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

const (
	wsTestOrigin  = "http://localhost:5173"
	wsTestProto   = "touhouflandre-multi.v2"
	wsInvalidOrig = "http://evil.example.com"
)

// wsURL 由 fast server http 地址推导 ws 地址。
func wsURL(roomID string) string {
	return "ws" + strings.TrimPrefix(fastBaseURL, "http") + "/api/rooms/" + roomID + "/ws"
}

// wsDial 建立 WS（可指定 Origin/子协议；nil opts 用合法默认）。
func wsDial(t *testing.T, roomID, token string, lastGameSequence int64, opts *websocket.DialOptions) *websocket.Conn {
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
	hello, _ := json.Marshal(multi.HelloMessage{Type: "hello", Token: token, LastGameSequence: lastGameSequence})
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
	_ = readUntilType(t, conn, target, max)
}

func readUntilType(t *testing.T, conn *websocket.Conn, target string, max int) map[string]any {
	t.Helper()
	for i := 0; i < max; i++ {
		msg := wsRead(t, conn)
		if msg["type"] == target {
			return msg
		}
	}
	t.Fatalf("drain %s: 未见 %s（已读 %d 帧）", target, target, max)
	return nil
}

func appendBarrierEvent(t *testing.T, roomID string) int64 {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := repo.New(tx)
	room, err := q.GetRoomForUpdate(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	members, err := q.ListMembers(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	spectators, err := q.CountSpectators(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if err := multi.AppendEvent(ctx, q, roomID, multi.EventRoomUpdated, multi.NewRoomUpdatedPayload(room, members, int(spectators))); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	fastHub.Publish(roomID)
	updated, err := repo.New(pool).GetRoom(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}
	return updated.EventSeq
}

func TestMultiWSConnectAndReplay(t *testing.T) {
	fixture := createMatchFixture(t)

	conn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	first := wsRead(t, conn)
	if first["type"] != "hello-ok" {
		t.Fatalf("first frame = %v, want hello-ok", first)
	}
	target, _ := first["targetGameSequence"].(float64)
	if target < 1 {
		t.Fatalf("targetGameSequence = %v, want >= 1", target)
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
	complete := wsRead(t, conn)
	if complete["type"] != "sync.complete" || complete["gameSequence"] != target {
		t.Fatalf("sync completion = %v, want target %v", complete, target)
	}

	// 实时广播：REST ready → WS 收到 room.updated
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}
	live := wsRead(t, conn)
	if live["type"] != "room.updated" {
		t.Fatalf("live event = %v, want room.updated", live)
	}
}

func TestMultiWSSyncBarrierClosesAllWriteWindows(t *testing.T) {
	fixture := createMatchFixture(t)
	stages := []string{}
	stageSequences := map[string]int64{}
	fastHub.SetSyncTestHook(func(stage string) {
		stages = append(stages, stage)
		stageSequences[stage] = appendBarrierEvent(t, fixture.roomID)
	})
	t.Cleanup(func() { fastHub.SetSyncTestHook(nil) })

	conn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	hello := wsRead(t, conn)
	if hello["type"] != "hello-ok" {
		t.Fatalf("first frame = %v, want hello-ok", hello)
	}
	target := int64(hello["targetGameSequence"].(float64))
	if target != stageSequences["registered"] {
		t.Fatalf("target = %d, want registered-stage watermark %d", target, stageSequences["registered"])
	}

	sequences := []int64{}
	var complete int64
	var firstLive int64
	for i := 0; i < 32; i++ {
		msg := wsRead(t, conn)
		switch msg["type"] {
		case "sync.complete":
			complete = int64(msg["gameSequence"].(float64))
		case "room.updated", "room.cursor":
			sequence := int64(msg["sequence"].(float64))
			sequences = append(sequences, sequence)
			if complete > 0 && sequence > complete {
				firstLive = sequence
			}
		}
		if firstLive > 0 {
			break
		}
	}
	if complete != stageSequences["replay_complete"] {
		t.Fatalf("sync.complete = %d, want replay-stage event %d", complete, stageSequences["replay_complete"])
	}
	if firstLive != stageSequences["live"] || firstLive != complete+1 {
		t.Fatalf("first live = %d, complete = %d, live-stage event = %d", firstLive, complete, stageSequences["live"])
	}
	for i, sequence := range sequences {
		want := int64(i + 1)
		if sequence != want {
			t.Fatalf("delivered sequences = %v, want continuous unique sequence at %d", sequences, want)
		}
	}
	wantStages := []string{"registered", "watermark_captured", "replay_complete", "live"}
	if len(stages) != len(wantStages) {
		t.Fatalf("barrier stages = %v, want %v", stages, wantStages)
	}
	for i := range wantStages {
		if stages[i] != wantStages[i] {
			t.Fatalf("barrier stages = %v, want %v", stages, wantStages)
		}
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

	// v1 页面不得与 v2 服务端表面连接成功。
	v1, _, err := websocket.Dial(ctx, wsURL(fixture.roomID), &websocket.DialOptions{
		HTTPHeader:   http.Header{"Origin": []string{wsTestOrigin}},
		Subprotocols: []string{"touhouflandre-multi.v1"},
	})
	if err != nil {
		return
	}
	defer v1.CloseNow()
	if _, _, err := v1.Read(ctx); err == nil {
		t.Fatal("v1 protocol should be rejected by v2 server")
	}
}

func TestMultiWSRejectsInvalidGameWatermarks(t *testing.T) {
	tests := []struct {
		name       string
		sequence   int64
		prepare    func(t *testing.T, fixture matchFixture)
		wantReason string
	}{
		{name: "negative", sequence: -1, wantReason: "negative_sequence"},
		{name: "ahead", sequence: 999, wantReason: "ahead_of_server"},
		{
			name:     "history unavailable",
			sequence: 1,
			prepare: func(t *testing.T, fixture matchFixture) {
				for i := 0; i < 3; i++ {
					_ = appendBarrierEvent(t, fixture.roomID)
				}
				if _, err := pool.Exec(ctx, "DELETE FROM room_event WHERE room_id = $1 AND sequence <= 3", fixture.roomID); err != nil {
					t.Fatal(err)
				}
			},
			wantReason: "history_unavailable",
		},
		{
			name:     "all history unavailable",
			sequence: 0,
			prepare: func(t *testing.T, fixture matchFixture) {
				if _, err := pool.Exec(ctx, "DELETE FROM room_event WHERE room_id = $1", fixture.roomID); err != nil {
					t.Fatal(err)
				}
			},
			wantReason: "history_unavailable",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := createMatchFixture(t)
			if test.prepare != nil {
				test.prepare(t, fixture)
			}
			conn := wsDial(t, fixture.roomID, fixture.hostToken, test.sequence, nil)
			msg := wsRead(t, conn)
			if msg["type"] != "resync.required" || msg["scope"] != "game" || msg["reason"] != test.wantReason {
				t.Fatalf("resync frame = %v, want reason %s", msg, test.wantReason)
			}
			if msg["gameSequence"] == nil {
				t.Fatalf("resync frame missing server watermark: %v", msg)
			}
		})
	}
}

func TestMultiWSRejectsMalformedHello(t *testing.T) {
	fixture := createMatchFixture(t)
	for _, raw := range []string{
		`{"type":"hello","token":"` + fixture.hostToken + `"}`,
		`{"type":"hello","token":"` + fixture.hostToken + `","lastGameSequence":0,"lastSequence":0}`,
		`{"type":"hello","token":"` + fixture.hostToken + `","lastGameSequence":"0"}`,
	} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		conn, _, err := websocket.Dial(ctx, wsURL(fixture.roomID), &websocket.DialOptions{
			HTTPHeader:   http.Header{"Origin": []string{wsTestOrigin}},
			Subprotocols: []string{wsTestProto},
		})
		if err != nil {
			cancel()
			t.Fatal(err)
		}
		if err := conn.Write(ctx, websocket.MessageText, []byte(raw)); err != nil {
			cancel()
			_ = conn.CloseNow()
			t.Fatal(err)
		}
		if _, _, err := conn.Read(ctx); err == nil {
			cancel()
			_ = conn.CloseNow()
			t.Fatalf("malformed hello was accepted: %s", raw)
		}
		cancel()
		_ = conn.CloseNow()
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
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"ack","gameSequence":0}`)); err != nil {
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
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}
	live := wsRead(t, second)
	if live["type"] != "room.updated" {
		t.Fatalf("second conn live event = %v", live)
	}
}

func TestMultiWSClaimSeatInvalidatesStaleSpectator(t *testing.T) {
	fixture := createLifecycleRoom(t, 1)
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 3 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	spectator := fixture.spectators[0]
	token := string(spectator.GuestToken)
	memberID := spectator.Viewer.MemberId

	old := wsDial(t, fixture.roomID, token, 0, nil)
	complete := readUntilType(t, old, "sync.complete", 16)
	originalWatermark := int64(complete["gameSequence"].(float64))

	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/claim-seat", token, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("claim seat: %d %s", resp.StatusCode, payload)
	}

	// claim 提交后，旧连接先收到身份失效控制帧，而不是按缓存 spectator 角色投影的新事件。
	changed := wsRead(t, old)
	if changed["type"] != "replaced" || changed["reason"] != "member_changed" {
		t.Fatalf("old spectator frame after claim = %v", changed)
	}
	readCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, _, err := old.Read(readCtx); err == nil {
		t.Fatal("old spectator connection remained open after member_changed")
	}

	// 服务端主动失效不能把刚认领的玩家误记为 disconnected，memberId/token 均保持不变。
	time.Sleep(20 * time.Millisecond)
	var role, status, tokenHash string
	var seat int
	var ready bool
	if err := pool.QueryRow(ctx, `
		SELECT role, status, token_hash, seat, ready
		FROM multi_member WHERE id = $1`, memberID).Scan(&role, &status, &tokenHash, &seat, &ready); err != nil {
		t.Fatal(err)
	}
	if role != string(multi.ParticipantRolePlayer) || status != string(multi.MemberStatusConnected) || seat != 3 || ready || tokenHash != multi.HashToken(token) {
		t.Fatalf("claimed member role=%s status=%s seat=%d ready=%v tokenPreserved=%v", role, status, seat, ready, tokenHash == multi.HashToken(token))
	}

	// 同一 token 从旧 sync.complete 水位重连，补齐 claim 期间事件并取得 player 视图。
	reconnected := wsDial(t, fixture.roomID, token, originalWatermark, nil)
	if hello := wsRead(t, reconnected); hello["type"] != "hello-ok" {
		t.Fatalf("reconnect hello = %v", hello)
	}
	watermark := originalWatermark
	var synced int64
	for i := 0; i < 16; i++ {
		frame := wsRead(t, reconnected)
		if sequence, ok := frame["sequence"].(float64); ok {
			if int64(sequence) != watermark+1 {
				t.Fatalf("reconnect gap after claim: previous=%d frame=%v", watermark, frame)
			}
			watermark = int64(sequence)
		}
		if frame["type"] == "sync.complete" {
			synced = int64(frame["gameSequence"].(float64))
			break
		}
	}
	if synced <= originalWatermark || synced != watermark {
		t.Fatalf("claim reconnect watermark original=%d replayed=%d complete=%d", originalWatermark, watermark, synced)
	}

	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("player snapshot after claim: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Viewer.MemberId != memberID || snapshot.Viewer.Role != openapi.ParticipantRolePlayer || snapshot.Viewer.Seat == nil || *snapshot.Viewer.Seat != 3 {
		t.Fatalf("reconnected player viewer = %+v", snapshot.Viewer)
	}
}

func TestMultiWSGuessBroadcast(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "race", 60)

	hostConn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	drainUntilType(t, hostConn, "sync.complete", 12)
	joinerConn := wsDial(t, fixture.roomID, fixture.joinerToken, 0, nil)
	drainUntilType(t, joinerConn, "sync.complete", 12)
	// 双方 ready → 对局开始；各自推进到 round.playing（容忍重放/连接事件的帧数差异）
	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready: %d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	hostPlaying := readUntilType(t, hostConn, "round.playing", 12)
	joinerPlaying := readUntilType(t, joinerConn, "round.playing", 12)

	// host 猜中 → joiner 收到匿名猜测、局末和赛末事件。
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "ws-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("guess: %d %s", resp.StatusCode, payload)
	}
	gotGuess, gotEnded, gotMatchEnded := false, false, false
	var joinerGuess, joinerEnded, joinerMatchEnded map[string]any
	for i := 0; i < 3; i++ { // 同事务三帧，按 sequence 广播。
		msg := wsRead(t, joinerConn)
		switch msg["type"] {
		case "round.opponent.guess":
			gotGuess = true
			joinerGuess = msg
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
			joinerEnded = msg
			p, _ := msg["payload"].(map[string]any)
			if p["viewerResult"] != "loss" {
				t.Fatalf("joiner round.ended viewerResult = %v, want loss", p["viewerResult"])
			}
		case "match.ended":
			gotMatchEnded = true
			joinerMatchEnded = msg
			p, _ := msg["payload"].(map[string]any)
			if p["viewerResult"] != "loss" {
				t.Fatalf("joiner match.ended viewerResult = %v, want loss", p["viewerResult"])
			}
		}
	}
	if !gotGuess || !gotEnded || !gotMatchEnded {
		t.Fatalf("joiner missed events: guess=%v ended=%v matchEnded=%v", gotGuess, gotEnded, gotMatchEnded)
	}
	if joinerGuess["sequence"] != joinerPlaying["sequence"].(float64)+1 ||
		joinerEnded["sequence"] != joinerGuess["sequence"].(float64)+1 ||
		joinerMatchEnded["sequence"] != joinerEnded["sequence"].(float64)+1 {
		t.Fatalf("joiner game sequence not continuous: playing=%v guess=%v ended=%v matchEnded=%v", joinerPlaying, joinerGuess, joinerEnded, joinerMatchEnded)
	}
	// host 视角：自己的猜测事件以同 sequence cursor 占位，随后收到局末和赛末事件。
	msg := wsRead(t, hostConn)
	if msg["type"] != "room.cursor" {
		t.Fatalf("host own guess frame = %v, want room.cursor", msg)
	}
	if _, leaked := msg["payload"]; leaked || len(msg) != 5 {
		t.Fatalf("room.cursor leaked business metadata: %v", msg)
	}
	if msg["eventId"] != joinerGuess["eventId"] || msg["sequence"] != hostPlaying["sequence"].(float64)+1 {
		t.Fatalf("cursor identity/sequence = %v, business frame = %v", msg, joinerGuess)
	}
	ended := wsRead(t, hostConn)
	if ended["type"] != "round.ended" {
		t.Fatalf("host frame = %v, want round.ended", ended["type"])
	}
	if ended["sequence"] != msg["sequence"].(float64)+1 {
		t.Fatalf("host game sequence not continuous: playing=%v cursor=%v ended=%v", hostPlaying, msg, ended)
	}
	matchEnded := wsRead(t, hostConn)
	if matchEnded["type"] != "match.ended" || matchEnded["sequence"] != ended["sequence"].(float64)+1 {
		t.Fatalf("host match completion = %v, want continuous match.ended", matchEnded)
	}
	p, _ := matchEnded["payload"].(map[string]any)
	if p["viewerResult"] != "win" {
		t.Fatalf("host match.ended viewerResult = %v, want win", p["viewerResult"])
	}
}

func TestMultiWSRelayBroadcast(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 30)
	hostConn := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	drainUntilType(t, hostConn, "sync.complete", 12)
	joinerConn := wsDial(t, fixture.roomID, fixture.joinerToken, 0, nil)
	drainUntilType(t, joinerConn, "sync.complete", 12)

	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready: %d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	hostPlaying := readUntilType(t, hostConn, "round.playing", 12)
	joinerPlaying := readUntilType(t, joinerConn, "round.playing", 12)

	answer := currentAnswer(t, fixture.roomID)
	wrong := guessableIDs(t, answer, 1)[0]
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, wrong, "ws-relay-host")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("host relay guess: %d %s", resp.StatusCode, payload)
	}
	hostFirst := wsRead(t, hostConn)
	joinerFirst := wsRead(t, joinerConn)
	if hostFirst["type"] != "round.shared.guess" || joinerFirst["type"] != "round.shared.guess" ||
		hostFirst["eventId"] != joinerFirst["eventId"] ||
		hostFirst["sequence"] != hostPlaying["sequence"].(float64)+1 ||
		joinerFirst["sequence"] != joinerPlaying["sequence"].(float64)+1 {
		t.Fatalf("first relay broadcast mismatch: host=%v joiner=%v", hostFirst, joinerFirst)
	}

	resp, payload = guess(t, fixture.roomID, fixture.joinerToken, 1, answer, "ws-relay-joiner-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("joiner relay guess: %d %s", resp.StatusCode, payload)
	}
	for name, conn := range map[string]*websocket.Conn{"host": hostConn, "joiner": joinerConn} {
		shared := wsRead(t, conn)
		roundEnded := wsRead(t, conn)
		matchEnded := wsRead(t, conn)
		if shared["type"] != "round.shared.guess" || shared["sequence"] != hostFirst["sequence"].(float64)+1 ||
			roundEnded["type"] != "round.ended" || roundEnded["sequence"] != shared["sequence"].(float64)+1 ||
			matchEnded["type"] != "match.ended" || matchEnded["sequence"] != roundEnded["sequence"].(float64)+1 {
			t.Fatalf("%s relay terminal sequence is not continuous: shared=%v round=%v match=%v", name, shared, roundEnded, matchEnded)
		}
		p, _ := matchEnded["payload"].(map[string]any)
		wantResult := "loss"
		if name == "joiner" {
			wantResult = "win"
		}
		if p["viewerResult"] != wantResult {
			t.Fatalf("%s match.ended viewerResult = %v, want %s", name, p["viewerResult"], wantResult)
		}
	}
}

func TestMultiWSV2SpectatorReadOnlyAndFinishedRetention(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "race", 60)
	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{"displayName": "观战者"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("spectator join: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	if spectator.Viewer.Role != openapi.ParticipantRoleSpectator || spectator.Viewer.Seat != nil {
		t.Fatalf("spectator identity = %+v", spectator.Viewer)
	}
	spectatorToken := string(spectator.GuestToken)
	spectatorConn := wsDial(t, fixture.roomID, spectatorToken, 0, nil)
	drainUntilType(t, spectatorConn, "sync.complete", 16)

	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", spectatorToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusForbidden || decodeError(t, payload).Code != "SPECTATOR_READ_ONLY" {
		t.Fatalf("spectator ready = %d %s, want SPECTATOR_READ_ONLY", resp.StatusCode, payload)
	}

	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready: %d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	playing := readUntilType(t, spectatorConn, "round.playing", 16)

	answer := currentAnswer(t, fixture.roomID)
	resp, payload = guess(t, fixture.roomID, spectatorToken, 1, answer, "spectator-write")
	if resp.StatusCode != http.StatusForbidden || decodeError(t, payload).Code != "SPECTATOR_READ_ONLY" {
		t.Fatalf("spectator guess = %d %s, want SPECTATOR_READ_ONLY", resp.StatusCode, payload)
	}
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "spectator-view")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("winning guess: %d %s", resp.StatusCode, payload)
	}

	guessEvent := wsRead(t, spectatorConn)
	roundEnded := wsRead(t, spectatorConn)
	matchEnded := wsRead(t, spectatorConn)
	if guessEvent["type"] != "round.spectator.guess" || guessEvent["sequence"] != playing["sequence"].(float64)+1 ||
		roundEnded["type"] != "round.ended" || roundEnded["sequence"] != guessEvent["sequence"].(float64)+1 ||
		matchEnded["type"] != "match.ended" || matchEnded["sequence"] != roundEnded["sequence"].(float64)+1 {
		t.Fatalf("spectator terminal sequence is not continuous: playing=%v guess=%v round=%v match=%v", playing, guessEvent, roundEnded, matchEnded)
	}
	guessPayload, _ := guessEvent["payload"].(map[string]any)
	if guessPayload["seat"] != float64(1) || guessPayload["guess"] == nil {
		t.Fatalf("spectator did not receive the full authorized guess: %v", guessPayload)
	}
	for _, event := range []map[string]any{roundEnded, matchEnded} {
		p, _ := event["payload"].(map[string]any)
		if p["viewerResult"] != nil {
			t.Fatalf("spectator terminal event exposes a player result: %v", p)
		}
	}

	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", spectatorToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("finished spectator snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != openapi.RoomStatusFinished || snapshot.Viewer.Role != openapi.ParticipantRoleSpectator {
		t.Fatalf("finished spectator snapshot = %+v", snapshot)
	}

	if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	closed := wsRead(t, spectatorConn)
	closedPayload, _ := closed["payload"].(map[string]any)
	if closed["type"] != "room.closed" || closed["sequence"] != matchEnded["sequence"].(float64)+1 || closedPayload["reason"] != "retention" {
		t.Fatalf("finished retention close = %v, want continuous room.closed(retention)", closed)
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

func TestMultiWSDisconnectedPlayerKeepsSeatAndReconnects(t *testing.T) {
	fixture := createMatchFixture(t)
	var memberID string
	var seat int
	if err := pool.QueryRow(ctx, "SELECT id, seat FROM multi_member WHERE room_id = $1 AND seat = 2", fixture.roomID).Scan(&memberID, &seat); err != nil {
		t.Fatal(err)
	}

	first := wsDial(t, fixture.roomID, fixture.joinerToken, 0, nil)
	complete := readUntilType(t, first, "sync.complete", 12)
	lastCompleted := int64(complete["gameSequence"].(float64))
	_ = first.CloseNow()

	deadline := time.Now().Add(3 * time.Second)
	for {
		var status string
		if err := pool.QueryRow(ctx, "SELECT status FROM multi_member WHERE id = $1", memberID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status == string(multi.MemberStatusDisconnected) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("player did not enter disconnect grace")
		}
		time.Sleep(20 * time.Millisecond)
	}

	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{"displayName": "宽限期加入者"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join during disconnect grace: %d %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	if joined.JoinRole != openapi.ParticipantRoleSpectator || joined.Viewer.Role != openapi.ParticipantRoleSpectator {
		t.Fatalf("disconnect grace seat was stolen: %+v", joined)
	}

	second := wsDial(t, fixture.roomID, fixture.joinerToken, lastCompleted, nil)
	if hello := wsRead(t, second); hello["type"] != "hello-ok" {
		t.Fatalf("reconnect hello = %v", hello)
	}
	reconnected := readUntilType(t, second, "sync.complete", 12)
	if int64(reconnected["gameSequence"].(float64)) <= lastCompleted {
		t.Fatalf("reconnect did not replay disconnect gap: before=%d complete=%v", lastCompleted, reconnected)
	}

	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reconnected snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Viewer.MemberId != memberID || snapshot.Viewer.Seat == nil || *snapshot.Viewer.Seat != seat || snapshot.Viewer.Status != openapi.MemberStatusConnected {
		t.Fatalf("reconnected viewer = %+v, want member %s seat %d connected", snapshot.Viewer, memberID, seat)
	}
	var players, spectators int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE role = 'player'),
		       count(*) FILTER (WHERE role = 'spectator' AND status <> 'left')
		FROM multi_member WHERE room_id = $1`, fixture.roomID).Scan(&players, &spectators); err != nil {
		t.Fatal(err)
	}
	if players != 2 || spectators != 1 {
		t.Fatalf("membership after reconnect players=%d spectators=%d, want 2/1", players, spectators)
	}
}

func TestMultiWSReplayAfterReconnect(t *testing.T) {
	fixture := createMatchFixture(t)

	first := wsDial(t, fixture.roomID, fixture.hostToken, 0, nil)
	var lastSeq float64
	for i := 0; i < 8; i++ {
		msg := wsRead(t, first)
		if msg["type"] == "sync.complete" {
			lastSeq, _ = msg["gameSequence"].(float64)
			break
		}
	}
	if lastSeq < 1 {
		t.Fatalf("initial sync gameSequence = %v", lastSeq)
	}
	// 记录已完成水位后断开。
	_ = first.CloseNow()

	// 断开期间发生事件（ready）
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready: %d %s", resp.StatusCode, payload)
	}

	// 重连携带 lastGameSequence → 只重放缺口游戏帧。
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
