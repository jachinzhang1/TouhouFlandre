// 多人房间与大厅集成测试（Phase 2）。
// 依赖 TestMain（server_test.go）：真实 Postgres（touhouflandre_test 库）+ 迁移 + seed + httptest server。
package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

// requestAuth 带游客令牌的请求（Authorization: Bearer guest:{token}）。
func requestAuth(method, path, token string, body any) (*http.Response, []byte) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, baseURL+path, reader)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer guest:"+token)
	}
	resp, err := client.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

// roomFixture 创建房间的测试夹具。
type roomFixture struct {
	RoomId     string
	RoomCode   string
	GuestToken string
}

// createRoom 创建 bo3 房间并解码响应。
func createRoom(t *testing.T) roomFixture {
	t.Helper()
	resp, payload := request(http.MethodPost, "/api/rooms", map[string]string{"format": "bo3"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create room status %d: %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatalf("decode create response: %v (%s)", err, payload)
	}
	return roomFixture{RoomId: created.RoomId, RoomCode: created.RoomCode, GuestToken: string(created.GuestToken)}
}
func TestMultiCreateRoom(t *testing.T) {
	resp, payload := request(http.MethodPost, "/api/rooms", map[string]string{"format": "bo3", "displayName": "  房主  "})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	if len(created.RoomCode) != 6 {
		t.Fatalf("roomCode %q, want 6 chars", created.RoomCode)
	}
	if created.Viewer.Seat == nil || *created.Viewer.Seat != 1 {
		t.Fatalf("host seat = %v, want 1", created.Viewer.Seat)
	}
	if created.Viewer.DisplayName != "房主" {
		t.Fatalf("displayName = %q, want 房主（trim）", created.Viewer.DisplayName)
	}
	if created.GuestToken == "" {
		t.Fatal("guestToken empty")
	}
	if len(created.RoomId) != 25 {
		t.Fatalf("roomId %q, want 25 chars", created.RoomId)
	}

	// 非法赛制 → 400 INVALID_FORMAT
	resp, payload = request(http.MethodPost, "/api/rooms", map[string]string{"format": "bo2"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid format status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "INVALID_FORMAT" {
		t.Fatalf("want INVALID_FORMAT, got %s", err.Code)
	}

	// 空昵称 → 匿名玩家
	resp, payload = request(http.MethodPost, "/api/rooms", map[string]string{"format": "bo1"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	if created.Viewer.DisplayName != "匿名玩家" {
		t.Fatalf("empty displayName = %q, want 匿名玩家", created.Viewer.DisplayName)
	}
}

func TestMultiRoomInfo(t *testing.T) {
	fixture := createRoom(t)

	resp, payload := request(http.MethodGet, "/api/rooms/"+fixture.RoomCode, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status %d: %s", resp.StatusCode, payload)
	}
	var info openapi.RoomInfo
	if err := json.Unmarshal(payload, &info); err != nil {
		t.Fatal(err)
	}
	if info.Format != openapi.Bo3 || info.Status != openapi.RoomStatusLobby || info.MemberCount != 1 {
		t.Fatalf("unexpected info: %+v", info)
	}

	// 房间号归一化（小写/空格/连字符）
	resp, payload = request(http.MethodGet, "/api/rooms/"+strings.ToLower(fixture.RoomCode), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("normalized info status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = request(http.MethodGet, "/api/rooms/"+insertHyphen(fixture.RoomCode), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("hyphen info status %d: %s", resp.StatusCode, payload)
	}

	// 不存在 → 404 ROOM_NOT_FOUND
	resp, payload = request(http.MethodGet, "/api/rooms/ZZZZZZ", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown room status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROOM_NOT_FOUND" {
		t.Fatalf("want ROOM_NOT_FOUND, got %s", err.Code)
	}
}

func TestMultiJoinRoom(t *testing.T) {
	fixture := createRoom(t)

	resp, payload := request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", map[string]string{"displayName": "玩家B"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join status %d: %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	if joined.Viewer.Seat == nil || *joined.Viewer.Seat != 2 || joined.Viewer.DisplayName != "玩家B" {
		t.Fatalf("unexpected viewer: %+v", joined.Viewer)
	}

	// 满员后继续加入 → spectator
	resp, payload = request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("spectator join status %d: %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	if spectator.Viewer.Role != openapi.ParticipantRoleSpectator || spectator.Viewer.Seat != nil {
		t.Fatalf("unexpected spectator viewer: %+v", spectator.Viewer)
	}

	// 观战者不占玩家容量：seat 2 释放后，下一名加入者仍成为玩家。
	resp, payload = requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/leave", string(joined.GuestToken), nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("player leave status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", map[string]string{"displayName": "补位玩家"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("replacement join status %d: %s", resp.StatusCode, payload)
	}
	var replacement openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &replacement); err != nil {
		t.Fatal(err)
	}
	if replacement.Viewer.Role != openapi.ParticipantRolePlayer || replacement.Viewer.Seat == nil || *replacement.Viewer.Seat != 2 {
		t.Fatalf("spectator consumed player capacity: %+v", replacement.Viewer)
	}
}

func TestMultiJoinNormalization(t *testing.T) {
	fixture := createRoom(t)
	// 小写 + 连字符混合输入（去空格/连字符、转大写；URL 路径不传空格）
	normalized := insertHyphen(strings.ToLower(fixture.RoomCode))
	resp, payload := request(http.MethodPost, "/api/rooms/"+normalized+"/join", nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("normalized join status %d: %s", resp.StatusCode, payload)
	}
}

func TestMultiJoinClosedRoom(t *testing.T) {
	fixture := createRoom(t)
	// 房主关闭后加入 → 404 ROOM_NOT_FOUND（已关闭）
	if resp, payload := requestAuth(http.MethodDelete, "/api/rooms/"+fixture.RoomId, fixture.GuestToken, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("close status %d: %s", resp.StatusCode, payload)
	}
	resp, payload := request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("join closed status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROOM_NOT_FOUND" {
		t.Fatalf("want ROOM_NOT_FOUND, got %s", err.Code)
	}
}

func TestMultiSnapshotAndEvents(t *testing.T) {
	fixture := createRoom(t)

	// 创建后：1 条 room.updated（sequence=1）
	resp, payload := requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot status %d: %s", resp.StatusCode, payload)
	}
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if snap.Status != openapi.RoomStatusLobby || len(snap.Members) != 1 || len(snap.Events) != 1 {
		t.Fatalf("unexpected snapshot: %+v", snap)
	}
	if snap.Events[0].Type != "room.updated" || snap.Events[0].Sequence != 1 {
		t.Fatalf("unexpected event: %+v", snap.Events[0])
	}
	if snap.Match != nil || snap.Round != nil {
		t.Fatalf("lobby snapshot must not have match/round: %+v", snap)
	}

	// 加入后：sequence=2 的 room.updated（2 成员）
	if resp, payload := request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", nil); resp.StatusCode != http.StatusCreated {
		t.Fatalf("join status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if len(snap.Members) != 2 || len(snap.Events) != 2 || snap.Events[1].Sequence != 2 {
		t.Fatalf("unexpected snapshot after join: %+v", snap)
	}

	// after=2 → 无事件
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot?after=2", fixture.GuestToken, nil)
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if len(snap.Events) != 0 {
		t.Fatalf("after=2 should return 0 events, got %d", len(snap.Events))
	}
}

func TestMultiReadyIdempotent(t *testing.T) {
	fixture := createRoom(t)

	resp, payload := requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/ready", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ready status %d: %s", resp.StatusCode, payload)
	}
	// 幂等：重复 ready 不报错
	resp, payload = requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/ready", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("repeat ready status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if !snap.Members[0].Ready {
		t.Fatalf("host ready not set: %+v", snap.Members[0])
	}
}

func TestMultiLeaveReleasesSlot(t *testing.T) {
	fixture := createRoom(t)
	// 房主 ready
	if resp, payload := requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/ready", fixture.GuestToken, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host ready status %d: %s", resp.StatusCode, payload)
	}
	// 加入者加入并 ready
	resp, payload := request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", nil)
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	joinerToken := string(joined.GuestToken)

	// 加入者离开（大厅）→ 删行释放 slot
	resp, payload = requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/leave", joinerToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if len(snap.Members) != 1 || !snap.Members[0].Ready {
		t.Fatalf("expected 1 member with host ready retained: %+v", snap.Members)
	}

	// 房间可再加入
	resp, payload = request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", nil)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("rejoin status %d: %s", resp.StatusCode, payload)
	}

	// 离开者的令牌已撤销（行删除）
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", joinerToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("left member token status %d: %s", resp.StatusCode, payload)
	}
}

func TestMultiHostLeaveClosesRoom(t *testing.T) {
	fixture := createRoom(t)
	resp, payload := requestAuth(http.MethodPost, "/api/rooms/"+fixture.RoomId+"/leave", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host leave status %d: %s", resp.StatusCode, payload)
	}
	// 房间已关闭：公开预检 404
	resp, payload = request(http.MethodGet, "/api/rooms/"+fixture.RoomCode, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("info after close status %d: %s", resp.StatusCode, payload)
	}
	// 成员仍可拉快照看终态（closed 保留期内）
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot after close status %d: %s", resp.StatusCode, payload)
	}
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	if snap.Status != openapi.RoomStatusClosed {
		t.Fatalf("room status = %s, want closed", snap.Status)
	}
	last := snap.Events[len(snap.Events)-1]
	if last.Type != "room.closed" {
		t.Fatalf("last event = %s, want room.closed", last.Type)
	}
	if payload, ok := last.Payload["reason"]; !ok || payload != "host_left" {
		t.Fatalf("room.closed reason = %v, want host_left", last.Payload)
	}
}

func TestMultiCloseByNonHost(t *testing.T) {
	fixture := createRoom(t)
	resp, payload := request(http.MethodPost, "/api/rooms/"+fixture.RoomCode+"/join", nil)
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	resp, payload = requestAuth(http.MethodDelete, "/api/rooms/"+fixture.RoomId, string(joined.GuestToken), nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("non-host close status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "GUEST_UNAUTHORIZED" {
		t.Fatalf("want GUEST_UNAUTHORIZED, got %s", err.Code)
	}
	// 房间仍在 lobby，房主可正常关闭
	resp, payload = requestAuth(http.MethodDelete, "/api/rooms/"+fixture.RoomId, fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host close status %d: %s", resp.StatusCode, payload)
	}
}

func TestMultiGuestTokenAuth(t *testing.T) {
	fixtureA := createRoom(t)
	fixtureB := createRoom(t)

	// 缺失令牌
	resp, payload := request(http.MethodGet, "/api/rooms/"+fixtureA.RoomId+"/snapshot", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token status %d: %s", resp.StatusCode, payload)
	}
	// 伪造令牌
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixtureA.RoomId+"/snapshot", "forged-token", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("forged token status %d: %s", resp.StatusCode, payload)
	}
	// 令牌类型不匹配（jwt: 前缀）
	req, _ := http.NewRequest(http.MethodGet, baseURL+"/api/rooms/"+fixtureA.RoomId+"/snapshot", nil)
	req.Header.Set("Authorization", "Bearer jwt:some-jwt")
	resp2, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("jwt prefix status %d", resp2.StatusCode)
	}
	// 跨房间令牌
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixtureA.RoomId+"/snapshot", fixtureB.GuestToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("cross-room token status %d: %s", resp.StatusCode, payload)
	}
}

func TestMultiJoinRateLimit(t *testing.T) {
	fixture := createRoom(t)
	// 独立 server（独立进程内限流器）：每 IP 每分钟 2 次
	limited := httptest.NewServer(server.NewWithOptions(pool, handler.WithJoinRateLimit(2, time.Minute)))
	defer limited.Close()
	limitedClient := limited.Client()

	doJoin := func() int {
		req, _ := http.NewRequest(http.MethodPost, limited.URL+"/api/rooms/"+fixture.RoomCode+"/join", strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		resp, err := limitedClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, resp.Body)
		return resp.StatusCode
	}
	if code := doJoin(); code != http.StatusCreated {
		t.Fatalf("1st join status %d", code)
	}
	if code := doJoin(); code != http.StatusCreated { // 玩家满员后仍可在限流配额内作为 spectator 加入
		t.Fatalf("2nd join status %d, want 201 spectator", code)
	}
	if code := doJoin(); code != http.StatusTooManyRequests {
		t.Fatalf("3rd join status %d, want 429", code)
	}
}

func TestMultiSweeperLobbyTTLAndCleanup(t *testing.T) {
	fixture := createRoom(t)

	// 手动过期 lobby TTL
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.RoomId); err != nil {
		t.Fatal(err)
	}
	sw := multi.NewSweeper(pool, multi.SweeperConfig{EventRetention: time.Hour})
	if err := sw.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}

	// 大厅过期 → 房间 closed（reason=ttl），公开预检 404
	resp, payload := request(http.MethodGet, "/api/rooms/"+fixture.RoomCode, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("info after ttl status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	last := snap.Events[len(snap.Events)-1]
	if last.Type != "room.closed" {
		t.Fatalf("last event = %s, want room.closed", last.Type)
	}
	if reason, _ := last.Payload["reason"].(string); reason != "ttl" {
		t.Fatalf("room.closed reason = %v, want ttl", last.Payload["reason"])
	}

	// 保留期到期 → 整树删除（单条 DELETE CASCADE），成员行随之消失 → 令牌撤销（§6.2）
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET expires_at = now() - interval '1 second' WHERE id = $1", fixture.RoomId); err != nil {
		t.Fatal(err)
	}
	if err := sw.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	var roomCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM multi_room WHERE id = $1", fixture.RoomId).Scan(&roomCount); err != nil {
		t.Fatal(err)
	}
	if roomCount != 0 {
		t.Fatalf("room row not deleted: %d", roomCount)
	}
	resp, _ = requestAuth(http.MethodGet, "/api/rooms/"+fixture.RoomId+"/snapshot", fixture.GuestToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("snapshot after cleanup status %d, want 401（成员行已随 CASCADE 删除，令牌撤销）", resp.StatusCode)
	}
	var memberCount int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM multi_member WHERE room_id = $1", fixture.RoomId).Scan(&memberCount); err != nil {
		t.Fatal(err)
	}
	if memberCount != 0 {
		t.Fatalf("member rows not cascaded: %d", memberCount)
	}
}

// insertHyphen 在房间号中间插入连字符（归一化测试用）。
func insertHyphen(code string) string {
	return code[:3] + "-" + code[3:]
}
