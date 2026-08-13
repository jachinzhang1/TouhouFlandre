// 多人对局引擎集成测试（Phase 3）。
// 使用 fastBaseURL（短时间常量注入）与手动驱动的 Sweeper；答案/状态经真实 Postgres 直查。
package server_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

// fastRequest / fastRequestAuth：短时间常量 server 的请求辅助。

func fastRequest(method, path string, body any) (*http.Response, []byte) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, fastBaseURL+path, reader)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := fastClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

func fastRequestAuth(method, path, token string, body any) (*http.Response, []byte) {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, fastBaseURL+path, reader)
	if err != nil {
		panic(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer guest:"+token)
	}
	resp, err := fastClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(resp.Body)
	return resp, payload
}

// fastSweeper 与 fast server 同时间常量、同 hub 的 sweeper（测试手动驱动；事件入库即广播）。
func fastSweeper() *multi.Sweeper {
	return multi.NewSweeper(pool, multi.SweeperConfig{Timing: fastTiming, EventRetention: time.Hour, Broadcaster: fastHub})
}

// advanceRounds 推进局间时序：间歇创建下一局（countdown）+ 倒计时到 playing。
// 需要两次 SweepOnce：第一次 advance 创建下一局，第二次 startCountdown 将其置为 playing。
func advanceRounds(t *testing.T) {
	t.Helper()
	time.Sleep(15 * time.Millisecond)
	sw := fastSweeper()
	if err := sw.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	if err := sw.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
}

// matchFixture 双人房间夹具（host 为房主 seat 1，joiner seat 2）。
type matchFixture struct {
	roomID      string
	roomCode    string
	hostToken   string
	joinerToken string
}

func collectionEntryAtSeat(t *testing.T, payload map[string]any, field string, seat int) map[string]any {
	t.Helper()
	entries, ok := payload[field].([]any)
	if !ok || entries == nil {
		t.Fatalf("%s = %#v, want non-nil array", field, payload[field])
	}
	for _, raw := range entries {
		entry, ok := raw.(map[string]any)
		if ok && entry["seat"] == float64(seat) {
			return entry
		}
	}
	t.Fatalf("%s has no seat %d entry: %#v", field, seat, entries)
	return nil
}

// createMatchFixture 创建 bo3 双人房间（fast server）。
func createMatchFixture(t *testing.T) matchFixture {
	t.Helper()
	return createMatchFixtureFormat(t, "bo3")
}

// createMatchFixtureFormat 以指定赛制创建双人房间（fast server）。
func createMatchFixtureFormat(t *testing.T, format string) matchFixture {
	t.Helper()
	return createMatchFixtureMode(t, format, "race", 60)
}

func createMatchFixtureMode(t *testing.T, format, mode string, turnSeconds int) matchFixture {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format":      format,
		"mode":        mode,
		"turnSeconds": turnSeconds,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join: %d %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	return matchFixture{
		roomID:      created.RoomId,
		roomCode:    created.RoomCode,
		hostToken:   string(created.GuestToken),
		joinerToken: string(joined.GuestToken),
	}
}

// startMatch 双方 ready → 推进 countdown → 返回进入 playing 后的快照。
func startMatch(t *testing.T, fixture matchFixture) openapi.RoomSnapshot {
	t.Helper()
	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("ready: %d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond) // countdown 5ms
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot: %d %s", resp.StatusCode, payload)
	}
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	return snap
}

// currentAnswer 直查当前局答案（测试白盒）。
func currentAnswer(t *testing.T, roomID string) string {
	t.Helper()
	var answer string
	err := pool.QueryRow(ctx, `
		SELECT r.answer_id FROM multi_round r
		JOIN multi_match m ON m.id = r.match_id
		WHERE m.room_id = $1 AND m.status = 'playing'
		ORDER BY r.round_index DESC LIMIT 1`, roomID).Scan(&answer)
	if err != nil {
		t.Fatal(err)
	}
	return answer
}

// guessableIDs 取 N 个非答案的可猜角色（测试白盒）。
func guessableIDs(t *testing.T, answer string, n int) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT id FROM character WHERE enabled_as_guess = true AND id <> $1 ORDER BY id LIMIT $2`, answer, n)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}
	if len(ids) < n {
		t.Fatalf("guessable ids %d < %d", len(ids), n)
	}
	return ids
}

func guess(t *testing.T, roomID, token string, roundIndex int, guessID, idempotencyKey string) (*http.Response, []byte) {
	t.Helper()
	return fastRequestAuth(http.MethodPost, "/api/rooms/"+roomID+"/rounds/"+itoa(roundIndex)+"/guess", token,
		map[string]string{"guessId": guessID, "idempotencyKey": idempotencyKey})
}

func itoa(v int) string {
	return string(rune('0' + v))
}

// eventsOf 拉取房间事件（host 视角）。
func eventsOf(t *testing.T, fixture matchFixture) []openapi.RoomEventEnvelope {
	t.Helper()
	return eventsOfAs(t, fixture, fixture.hostToken)
}

// eventsOfAs 以指定成员视角拉取事件。
func eventsOfAs(t *testing.T, fixture matchFixture, token string) []openapi.RoomEventEnvelope {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot: %d %s", resp.StatusCode, payload)
	}
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	return snap.Events
}

func TestMultiMatchStart(t *testing.T) {
	fixture := createMatchFixture(t)

	// 单方 ready → 不开局
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host ready: %d %s", resp.StatusCode, payload)
	}
	snap := startMatch(t, fixture)
	if snap.Status != openapi.RoomStatusPlaying {
		t.Fatalf("room status = %s, want playing", snap.Status)
	}
	if snap.Match == nil {
		t.Fatal("match view missing")
	}
	if snap.Match.MatchIndex != 0 || snap.Match.TargetWins != 2 || snap.Match.RoundIndex != 1 {
		t.Fatalf("unexpected match view: %+v", snap.Match)
	}
	if snap.Round == nil || snap.Round.Status != openapi.RoundStatusPlaying {
		t.Fatalf("round view = %+v, want playing", snap.Round)
	}
	if len(snap.Members) != 2 || snap.Members[0].Seat != 1 || snap.Members[1].Seat != 2 ||
		snap.Members[0].MemberId == "" || snap.Members[1].MemberId == "" {
		t.Fatalf("member collection = %+v, want two public identities in seat order", snap.Members)
	}
	if snap.Viewer.MemberId != snap.Members[0].MemberId || snap.Viewer.Seat == nil || *snap.Viewer.Seat != 1 {
		t.Fatalf("viewer = %+v, want seat 1 member identity", snap.Viewer)
	}
	if len(snap.Match.Scores) != 2 ||
		snap.Match.Scores[0].MemberId != snap.Members[0].MemberId || snap.Match.Scores[0].Seat != 1 ||
		snap.Match.Scores[1].MemberId != snap.Members[1].MemberId || snap.Match.Scores[1].Seat != 2 {
		t.Fatalf("score collection = %+v, want member identities in seat order", snap.Match.Scores)
	}
	if snap.Round.Self.MemberId == nil || *snap.Round.Self.MemberId != snap.Members[0].MemberId ||
		snap.Round.Self.Seat == nil || *snap.Round.Self.Seat != 1 || len(snap.Round.Opponents) != 1 ||
		snap.Round.Opponents[0].MemberId != snap.Members[1].MemberId || snap.Round.Opponents[0].Seat != 2 {
		t.Fatalf("race board identities = self:%+v opponents:%+v", snap.Round.Self, snap.Round.Opponents)
	}
	if len(snap.Events) < 2 {
		t.Fatalf("expected match.started + round.started events, got %d", len(snap.Events))
	}

	// 对局已开始后的重复 ready → MATCH_ALREADY_STARTED
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.joinerToken, map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("repeat ready status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "MATCH_ALREADY_STARTED" {
		t.Fatalf("want MATCH_ALREADY_STARTED, got %s", err.Code)
	}
}

func TestMultiFlexibleRaceRosterStart(t *testing.T) {
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]any{
		"format": "bo1",
		"mode":   "race",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET player_limit = 8 WHERE id = $1", created.RoomId); err != nil {
		t.Fatal(err)
	}
	tokens := []string{string(created.GuestToken)}
	wantPlayers := map[string]bool{created.Viewer.MemberId: true}
	for i := 0; i < 2; i++ {
		resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join player %d: %d %s", i+2, resp.StatusCode, payload)
		}
		var joined openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &joined); err != nil {
			t.Fatal(err)
		}
		if joined.JoinRole != openapi.ParticipantRolePlayer {
			t.Fatalf("join player %d role = %s", i+2, joined.JoinRole)
		}
		tokens = append(tokens, string(joined.GuestToken))
		wantPlayers[joined.Viewer.MemberId] = true
	}

	// 两名已准备玩家不能绕过第三名未准备玩家开局。
	for _, token := range tokens[:2] {
		resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+created.RoomId+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("partial ready: %d %s", resp.StatusCode, payload)
		}
	}
	var roomStatus string
	var matchCount int
	if err := pool.QueryRow(ctx, `
		SELECT r.status, count(m.id)
		FROM multi_room r LEFT JOIN multi_match m ON m.room_id = r.id
		WHERE r.id = $1 GROUP BY r.status`, created.RoomId).Scan(&roomStatus, &matchCount); err != nil {
		t.Fatal(err)
	}
	if roomStatus != string(multi.RoomStatusLobby) || matchCount != 0 {
		t.Fatalf("unready player was bypassed: status=%s matches=%d", roomStatus, matchCount)
	}

	// 第三名准备后以 3/8 的未满阵容开局。
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+created.RoomId+"/ready", tokens[2], map[string]bool{"ready": true})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("final ready: %d %s", resp.StatusCode, payload)
	}
	if err := pool.QueryRow(ctx, `
		SELECT r.status, count(m.id)
		FROM multi_room r LEFT JOIN multi_match m ON m.room_id = r.id
		WHERE r.id = $1 GROUP BY r.status`, created.RoomId).Scan(&roomStatus, &matchCount); err != nil {
		t.Fatal(err)
	}
	if roomStatus != string(multi.RoomStatusPlaying) || matchCount != 1 {
		t.Fatalf("3/8 ready roster did not start: status=%s matches=%d", roomStatus, matchCount)
	}

	// 开局后新 member 只能观战，隐式冻结的 player 集合保持不变。
	resp, payload = fastRequest(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("post-start spectator join: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	if spectator.JoinRole != openapi.ParticipantRoleSpectator {
		t.Fatalf("post-start join role = %s, want spectator", spectator.JoinRole)
	}
	rows, err := pool.Query(ctx, "SELECT id FROM multi_member WHERE room_id = $1 AND role = 'player' ORDER BY seat", created.RoomId)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	gotPlayers := map[string]bool{}
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			t.Fatal(err)
		}
		gotPlayers[memberID] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(gotPlayers) != len(wantPlayers) {
		t.Fatalf("frozen players = %v, want %v", gotPlayers, wantPlayers)
	}
	for memberID := range wantPlayers {
		if !gotPlayers[memberID] {
			t.Fatalf("frozen roster lost member %s: %v", memberID, gotPlayers)
		}
	}
}

func TestMultiGuessWin(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)

	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "key-win-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("guess status %d: %s", resp.StatusCode, payload)
	}
	var accepted openapi.GuessResponse
	if err := json.Unmarshal(payload, &accepted); err != nil {
		t.Fatal(err)
	}
	if !accepted.Guess.IsCorrect {
		t.Fatalf("winning guess marked incorrect: %+v", accepted.Guess)
	}
	if len(accepted.Guess.Feedback) != 6 {
		t.Fatalf("feedback fields = %d, want 6", len(accepted.Guess.Feedback))
	}
	for _, fb := range accepted.Guess.Feedback {
		if fb.Label == "" || fb.DisplayValue == nil {
			t.Fatalf("feedback missing display fields: %+v", fb)
		}
	}

	// 局结束：bo3 1-0，round.ended 事件
	events := eventsOf(t, fixture)
	var ended *openapi.RoomEventEnvelope
	for i := range events {
		if events[i].Type == "round.ended" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatal("round.ended event missing")
	}
	payloadMap := ended.Payload
	if payloadMap["viewerResult"] != "win" {
		t.Fatalf("round.ended viewerResult = %v, want win", payloadMap["viewerResult"])
	}
	answerView, _ := payloadMap["answer"].(map[string]any)
	if answerView["name"] == "" || answerView["avatarUrl"] == "" ||
		answerView["workId"] == "" || answerView["workTitle"] == "" || answerView["workCode"] == "" {
		t.Fatalf("round.ended answer not revealed: %v", payloadMap["answer"])
	}
	if collectionEntryAtSeat(t, payloadMap, "scores", 1)["score"] != float64(1) ||
		collectionEntryAtSeat(t, payloadMap, "scores", 2)["score"] != float64(0) {
		t.Fatalf("round.ended scores = %v", payloadMap["scores"])
	}

	// 逐观察者：host 自己的猜测事件不在其回放中；joiner 视角可见（已列置换、无 memberSlot/roundId）
	for _, e := range events {
		if e.Type == "round.opponent.guess" {
			t.Fatalf("host replay must not contain own guess event: %+v", e)
		}
	}
	joinerEvents := eventsOfAs(t, fixture, fixture.joinerToken)
	var opponentGuess *openapi.RoomEventEnvelope
	for i := range joinerEvents {
		if joinerEvents[i].Type == "round.opponent.guess" {
			opponentGuess = &joinerEvents[i]
		}
	}
	if opponentGuess == nil {
		t.Fatal("joiner replay missing opponent guess event")
	}
	gp := opponentGuess.Payload
	if _, leaked := gp["memberSlot"]; leaked {
		t.Fatalf("projected guess event leaks memberSlot: %v", gp)
	}
	statuses, _ := gp["statuses"].([]any)
	if len(statuses) != 6 {
		t.Fatalf("projected statuses = %d, want 6", len(statuses))
	}
	if gp["rowIndex"] != float64(1) {
		t.Fatalf("projected rowIndex = %v, want 1", gp["rowIndex"])
	}
}

func TestMultiGuessRace(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)

	var mu sync.Mutex
	statuses := map[string]int{}
	var wg sync.WaitGroup
	for _, token := range []string{fixture.hostToken, fixture.joinerToken} {
		wg.Add(1)
		go func(token string) {
			defer wg.Done()
			resp, payload := guess(t, fixture.roomID, token, 1, answer, "race-"+token)
			mu.Lock()
			defer mu.Unlock()
			if resp.StatusCode == http.StatusOK {
				statuses["200"]++
			} else {
				statuses[itoa(resp.StatusCode)]++
				var apiErr openapi.ErrorResponse
				_ = json.Unmarshal(payload, &apiErr)
				statuses[string(apiErr.Code)]++
			}
		}(token)
	}
	wg.Wait()

	// 恰一个胜者：一个 200，另一个 409 ROUND_ENDED（猜测不写入）
	if statuses["200"] != 1 {
		t.Fatalf("winning guesses = %d, want exactly 1 (%v)", statuses["200"], statuses)
	}
	if statuses["ROUND_ENDED"] != 1 {
		t.Fatalf("loser should get ROUND_ENDED: %v", statuses)
	}
}

func TestRelayModeSharedTurns(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 30)
	resp, payload := fastRequest(http.MethodGet, "/api/rooms/"+fixture.roomCode, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("info status %d: %s", resp.StatusCode, payload)
	}
	var info openapi.RoomInfo
	if err := json.Unmarshal(payload, &info); err != nil {
		t.Fatal(err)
	}
	if info.Mode != openapi.Relay || int(info.TurnSeconds) != 30 {
		t.Fatalf("room info mode/turn = %s/%d, want relay/30", info.Mode, info.TurnSeconds)
	}

	snap := startMatch(t, fixture)
	if snap.Mode != openapi.Relay || int(snap.TurnSeconds) != 30 {
		t.Fatalf("snapshot mode/turn = %s/%d, want relay/30", snap.Mode, snap.TurnSeconds)
	}
	if snap.Round == nil || snap.Round.TurnSeat == nil || *snap.Round.TurnSeat != 1 ||
		snap.Round.TurnMemberId == nil || *snap.Round.TurnMemberId != snap.Members[0].MemberId ||
		snap.Round.TurnDeadline == nil || snap.Round.MaxTurnsPerPlayer == nil || *snap.Round.MaxTurnsPerPlayer != 8 {
		t.Fatalf("relay round fields = %+v", snap.Round)
	}

	answer := currentAnswer(t, fixture.roomID)
	wrongIDs := guessableIDs(t, answer, 3)
	resp, payload = guess(t, fixture.roomID, fixture.joinerToken, 1, wrongIDs[0], "relay-not-your-turn")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("joiner early guess status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "NOT_YOUR_TURN" {
		t.Fatalf("want NOT_YOUR_TURN, got %s", err.Code)
	}

	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, wrongIDs[0], "relay-host-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("host relay guess status %d: %s", resp.StatusCode, payload)
	}
	snap = startMatchSnapshotAs(t, fixture, fixture.joinerToken)
	if snap.Round == nil || snap.Round.Shared == nil || len(snap.Round.Shared.Rows) != 1 {
		t.Fatalf("joiner shared rows = %+v", snap.Round)
	}
	row := snap.Round.Shared.Rows[0]
	if row.Kind != "guess" || row.Seat != 1 || row.MemberId != snap.Members[0].MemberId || row.Guess == nil || len(row.Guess.Feedback) != 6 {
		t.Fatalf("shared guess row = %+v", row)
	}
	if snap.Round.TurnSeat == nil || *snap.Round.TurnSeat != 2 ||
		snap.Round.TurnMemberId == nil || *snap.Round.TurnMemberId != snap.Members[1].MemberId {
		t.Fatalf("turn after host guess = member:%+v seat:%+v, want seat 2 member", snap.Round.TurnMemberId, snap.Round.TurnSeat)
	}

	if _, err := pool.Exec(ctx, `
		UPDATE multi_round r
		SET turn_deadline = now() - interval '1 second'
		FROM multi_match m
		WHERE r.match_id = m.id AND m.room_id = $1 AND r.round_index = 1`,
		fixture.roomID); err != nil {
		t.Fatal(err)
	}
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, wrongIDs[1], "relay-host-after-timeout")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("host after timeout status %d: %s", resp.StatusCode, payload)
	}
	snap = startMatchSnapshot(t, fixture)
	if snap.Round == nil || snap.Round.Shared == nil || len(snap.Round.Shared.Rows) != 3 {
		t.Fatalf("shared rows after timeout = %+v", snap.Round)
	}
	if snap.Round.Shared.Rows[1].Kind != "timeout" || snap.Round.Shared.Rows[1].Seat != 2 ||
		snap.Round.Shared.Rows[1].MemberId != snap.Members[1].MemberId {
		t.Fatalf("timeout row = %+v", snap.Round.Shared.Rows[1])
	}
	if snap.Round.Shared.Rows[2].Kind != "guess" || snap.Round.Shared.Rows[2].Seat != 1 ||
		snap.Round.Shared.Rows[2].MemberId != snap.Members[0].MemberId {
		t.Fatalf("post-timeout guess row = %+v", snap.Round.Shared.Rows[2])
	}
	if snap.Round.TurnSeat == nil || *snap.Round.TurnSeat != 2 ||
		snap.Round.TurnMemberId == nil || *snap.Round.TurnMemberId != snap.Members[1].MemberId {
		t.Fatalf("turn after post-timeout host guess = member:%+v seat:%+v, want seat 2 member", snap.Round.TurnMemberId, snap.Round.TurnSeat)
	}

	resp, payload = guess(t, fixture.roomID, fixture.joinerToken, 1, answer, "relay-joiner-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("joiner relay win status %d: %s", resp.StatusCode, payload)
	}
	var roundEnded, matchEnded map[string]any
	for _, event := range eventsOf(t, fixture) {
		switch event.Type {
		case "round.ended":
			roundEnded = event.Payload
		case "match.ended":
			matchEnded = event.Payload
		}
	}
	if roundEnded == nil || matchEnded == nil {
		t.Fatalf("relay terminal events missing: round=%v match=%v", roundEnded, matchEnded)
	}
	seat2Result := collectionEntryAtSeat(t, roundEnded, "results", 2)
	if roundEnded["viewerResult"] != "loss" || roundEnded["winnerMemberId"] != seat2Result["memberId"] || seat2Result["result"] != "win" {
		t.Fatalf("relay round result = %v, want host loss and seat 2 winner", roundEnded)
	}
	if collectionEntryAtSeat(t, roundEnded, "scores", 1)["score"] != float64(0) ||
		collectionEntryAtSeat(t, roundEnded, "scores", 2)["score"] != float64(1) {
		t.Fatalf("relay round scores = %v, want 0-1", roundEnded["scores"])
	}
	turns, ok := roundEnded["turns"].([]any)
	if !ok || len(turns) != 4 {
		t.Fatalf("relay turns = %#v, want four preserved rows", roundEnded["turns"])
	}
	lastTurn, _ := turns[3].(map[string]any)
	if lastTurn["memberId"] != seat2Result["memberId"] || lastTurn["seat"] != float64(2) || lastTurn["kind"] != "guess" {
		t.Fatalf("relay winning turn = %#v, want seat 2 member guess", lastTurn)
	}
	if matchEnded["viewerResult"] != "loss" || matchEnded["winnerMemberId"] != seat2Result["memberId"] || matchEnded["reason"] != "normal" {
		t.Fatalf("relay match result = %v, want normal seat 2 win", matchEnded)
	}
	joinerEvents := eventsOfAs(t, fixture, fixture.joinerToken)
	joinerWon := false
	for _, event := range joinerEvents {
		if event.Type == "match.ended" {
			joinerWon = true
			if event.Payload["viewerResult"] != "win" {
				t.Fatalf("joiner relay viewerResult = %v, want win", event.Payload["viewerResult"])
			}
		}
	}
	if !joinerWon {
		t.Fatal("joiner relay match.ended event missing")
	}
}

func TestMultiDuplicateAndIdempotentGuess(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)
	ids := guessableIDs(t, answer, 2)
	wrong := ids[0]

	// 幂等：同 (guess, idempotencyKey) 重试返回首次结果
	body := map[string]string{"guessId": wrong, "idempotencyKey": "idem-1"}
	resp1, payload1 := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/guess", fixture.hostToken, body)
	resp2, payload2 := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/guess", fixture.hostToken, body)
	if resp1.StatusCode != http.StatusOK || resp2.StatusCode != http.StatusOK {
		t.Fatalf("idempotent statuses %d/%d: %s / %s", resp1.StatusCode, resp2.StatusCode, payload1, payload2)
	}
	var first, second openapi.GuessResponse
	_ = json.Unmarshal(payload1, &first)
	_ = json.Unmarshal(payload2, &second)
	if first.Guess.GuessId != second.Guess.GuessId || first.Guess.IsCorrect != second.Guess.IsCorrect {
		t.Fatalf("idempotent replay differs: %+v vs %+v", first.Guess, second.Guess)
	}
	var count int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM multi_guess g
		JOIN multi_round r ON r.id = g.round_id
		JOIN multi_match m ON m.id = r.match_id
		WHERE m.room_id = $1 AND g.member_id = (SELECT id FROM multi_member WHERE room_id = $1 AND seat = 1)`,
		fixture.roomID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("idempotent retry inserted %d rows, want 1", count)
	}

	// 重复角色（新幂等键）→ DUPLICATE_GUESS
	resp3, payload3 := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/guess", fixture.hostToken,
		map[string]string{"guessId": wrong, "idempotencyKey": "idem-2"})
	if resp3.StatusCode != http.StatusConflict {
		t.Fatalf("duplicate status %d: %s", resp3.StatusCode, payload3)
	}
	if err := decodeError(t, payload3); err.Code != "DUPLICATE_GUESS" {
		t.Fatalf("want DUPLICATE_GUESS, got %s", err.Code)
	}
}

func TestMultiGuessLimitAndDraw(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)
	wrongIDs := guessableIDs(t, answer, 9)

	// host 8 猜，joiner 1 猜 → 局仍在进行，host 第 9 猜 → GUESS_LIMIT_REACHED
	for i := 0; i < 8; i++ {
		resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, wrongIDs[i], "host-"+itoa(i))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("host guess %d status %d: %s", i, resp.StatusCode, payload)
		}
	}
	resp, payload := guess(t, fixture.roomID, fixture.joinerToken, 1, wrongIDs[8], "join-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("joiner guess status %d: %s", resp.StatusCode, payload)
	}
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, wrongIDs[0], "host-over")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("over-limit status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "GUESS_LIMIT_REACHED" {
		t.Fatalf("want GUESS_LIMIT_REACHED, got %s", err.Code)
	}
	// joiner 补足 8 猜（可复用 host 猜过的角色；与对手重复无限制）→ 双方用尽平局
	for i := 1; i < 8; i++ {
		resp, payload := guess(t, fixture.roomID, fixture.joinerToken, 1, wrongIDs[i-1], "join-"+itoa(i+1))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("joiner guess %d status %d: %s", i, resp.StatusCode, payload)
		}
	}
	events := eventsOf(t, fixture)
	var ended *openapi.RoomEventEnvelope
	for i := range events {
		if events[i].Type == "round.ended" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatal("round.ended missing after draw")
	}
	if ended.Payload["viewerResult"] != "draw" {
		t.Fatalf("draw viewerResult = %v", ended.Payload["viewerResult"])
	}
}

func TestMultiSnapshotWithGuesses(t *testing.T) {
	// 回归：局中有猜测时快照端点必须 200（statuses 数组形态解码，曾 500）
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)
	wrong := guessableIDs(t, answer, 1)[0]
	if resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, wrong, "snap-guess"); resp.StatusCode != http.StatusOK {
		t.Fatalf("guess: %d %s", resp.StatusCode, payload)
	}
	snap := startMatchSnapshot(t, fixture)
	if snap.Round == nil {
		t.Fatal("round view missing from snapshot")
	}
	if len(snap.Round.Self.Guesses) != 1 {
		t.Fatalf("self guesses = %d, want 1", len(snap.Round.Self.Guesses))
	}
	if len(snap.Round.Self.Guesses[0].Feedback) != 6 {
		t.Fatalf("feedback fields = %d, want 6", len(snap.Round.Self.Guesses[0].Feedback))
	}
}

// TestRoundEndedBoardsNotNull 回归：单方猜中即结束，对手 0 猜测时
// round.ended 投影的 boards 空槽必须是 []（曾为 null，前端 opponentBoard.length 崩溃）。
func TestRoundEndedBoardsNotNull(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)
	if resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "winning-guess"); resp.StatusCode != http.StatusOK {
		t.Fatalf("guess: %d %s", resp.StatusCode, payload)
	}
	snap := startMatchSnapshot(t, fixture)
	var ended *openapi.RoomEventEnvelope
	for i := range snap.Events {
		if snap.Events[i].Type == "round.ended" {
			ended = &snap.Events[i]
			break
		}
	}
	if ended == nil {
		t.Fatalf("round.ended 事件缺失: %+v", snap.Events)
	}
	seat2 := collectionEntryAtSeat(t, ended.Payload, "boards", 2)
	seat2Guesses, ok := seat2["guesses"].([]any)
	if !ok || seat2Guesses == nil || len(seat2Guesses) != 0 {
		t.Fatalf("seat 2 guesses = %#v, want non-nil empty array", seat2["guesses"])
	}
	seat1 := collectionEntryAtSeat(t, ended.Payload, "boards", 1)
	if seat1Guesses, ok := seat1["guesses"].([]any); !ok || len(seat1Guesses) != 1 {
		t.Fatalf("seat 1 guesses = %#v, want one guess", seat1["guesses"])
	}
	// 弹窗倒计时：nextStartsAt = 本局 ended_at + INTERMISSION（服务端驱动，08 §局末交互）。
	next, ok := ended.Payload["nextStartsAt"].(string)
	if !ok {
		t.Fatalf("nextStartsAt 缺失: %+v", ended.Payload)
	}
	nextTime, err := time.Parse(time.RFC3339Nano, next)
	if err != nil {
		t.Fatalf("nextStartsAt 解析失败: %v", err)
	}
	endedAt, err := time.Parse(time.RFC3339Nano, ended.OccurredAt.Format(time.RFC3339Nano))
	if err != nil {
		t.Fatal(err)
	}
	// nextStartsAt = 事务内 now + INTERMISSION；occurredAt 为 DB 落库时刻，允许事务延迟。
	if delta := nextTime.Sub(endedAt); delta < 0 || delta > 5*time.Second {
		t.Fatalf("nextStartsAt - endedAt = %v, 应为 INTERMISSION 附近的小值", delta)
	}
}

func TestMultiGuessTimeout(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	// deadline 置为过去 → 猜测被拒（ROUND_NOT_ACTIVE）且本局按平局结算（不判胜）
	if _, err := pool.Exec(ctx, `
		UPDATE multi_round SET deadline = now() - interval '1 second'
		WHERE id = (SELECT r.id FROM multi_round r JOIN multi_match m ON m.id = r.match_id WHERE m.room_id = $1 AND r.status = 'playing')`,
		fixture.roomID); err != nil {
		t.Fatal(err)
	}
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "timeout-1")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("timeout guess status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROUND_NOT_ACTIVE" {
		t.Fatalf("want ROUND_NOT_ACTIVE, got %s", err.Code)
	}
	// 局已按平局结算
	var status, winner string
	err := pool.QueryRow(ctx, `
		SELECT r.status, COALESCE(r.winner_slot::text, '') FROM multi_round r
		JOIN multi_match m ON m.id = r.match_id WHERE m.room_id = $1 ORDER BY r.round_index DESC LIMIT 1`,
		fixture.roomID).Scan(&status, &winner)
	if err != nil {
		t.Fatal(err)
	}
	if status != "ended" || winner != "" {
		t.Fatalf("timeout settle = status %s winner %q, want ended draw", status, winner)
	}
}

func TestMultiEndedRoundBranch(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)

	// host 猜中 → 局 1 结束（尚未推进下一局）
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "win-1")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("win status %d: %s", resp.StatusCode, payload)
	}
	// 局结束后正确猜测 → ROUND_ENDED（携带局结果）
	resp, payload = guess(t, fixture.roomID, fixture.joinerToken, 1, answer, "late-correct")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("late correct status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROUND_ENDED" {
		t.Fatalf("want ROUND_ENDED, got %s", err.Code)
	}
	// 局结束后错误猜测 → ROUND_NOT_ACTIVE
	wrong := guessableIDs(t, answer, 1)[0]
	resp, payload = guess(t, fixture.roomID, fixture.joinerToken, 1, wrong, "late-wrong")
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("late wrong status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROUND_NOT_ACTIVE" {
		t.Fatalf("want ROUND_NOT_ACTIVE, got %s", err.Code)
	}
}

func TestMultiFullBO3AndIntermission(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	// 推进两局：host 连赢两局 → 2-0 match.ended normal
	for roundIndex := 1; roundIndex <= 2; roundIndex++ {
		answer := currentAnswer(t, fixture.roomID)
		resp, payload := guess(t, fixture.roomID, fixture.hostToken, roundIndex, answer, "bo3-win-"+itoa(roundIndex))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("round %d win status %d: %s", roundIndex, resp.StatusCode, payload)
		}
		if roundIndex == 1 {
			// 间歇推进：round 2 startsAt = round 1 ended_at + INTERMISSION（事件时间戳验证）
			advanceRounds(t)
			events := eventsOf(t, fixture)
			var started1, started2 *openapi.RoomEventEnvelope
			for i := range events {
				switch events[i].Type {
				case "round.started":
					if started1 == nil {
						started1 = &events[i]
					} else {
						started2 = &events[i]
					}
				}
			}
			if started1 == nil || started2 == nil {
				t.Fatal("expected two round.started events")
			}
			s1 := started1.Payload["startsAt"].(string)
			s2 := started2.Payload["startsAt"].(string)
			t1, _ := time.Parse(time.RFC3339Nano, s1)
			t2, _ := time.Parse(time.RFC3339Nano, s2)
			if t2.Sub(t1) < 5*time.Millisecond {
				t.Fatalf("round2 startsAt not after intermission: %v", t2.Sub(t1))
			}
		}
	}
	// match.ended normal 2-0
	events := eventsOf(t, fixture)
	var ended *openapi.RoomEventEnvelope
	for i := range events {
		if events[i].Type == "match.ended" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatal("match.ended missing")
	}
	p := ended.Payload
	if p["reason"] != "normal" || p["viewerResult"] != "win" {
		t.Fatalf("match.ended payload = %v", p)
	}
	if collectionEntryAtSeat(t, p, "scores", 1)["score"] != float64(2) ||
		collectionEntryAtSeat(t, p, "scores", 2)["score"] != float64(0) {
		t.Fatalf("final scores = %v", p["scores"])
	}
	// 房间 finished（展示期）
	snap := startMatchSnapshot(t, fixture)
	if snap.Status != openapi.RoomStatusFinished {
		t.Fatalf("room status = %s, want finished", snap.Status)
	}
}

// startMatchSnapshot 拉取快照（host 视角）。
func startMatchSnapshot(t *testing.T, fixture matchFixture) openapi.RoomSnapshot {
	t.Helper()
	return startMatchSnapshotAs(t, fixture, fixture.hostToken)
}

func startMatchSnapshotAs(t *testing.T, fixture matchFixture, token string) openapi.RoomSnapshot {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("snapshot: %d %s", resp.StatusCode, payload)
	}
	var snap openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snap); err != nil {
		t.Fatal(err)
	}
	return snap
}

func TestMultiForfeit(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("forfeit leave: %d %s", resp.StatusCode, payload)
	}
	// 对方视角可拉取结果。
	events := eventsOfAs(t, fixture, fixture.joinerToken)
	var ended *openapi.RoomEventEnvelope
	for i := range events {
		if events[i].Type == "match.ended" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatal("match.ended missing after forfeit")
	}
	p := ended.Payload
	if p["reason"] != "forfeit" || p["viewerResult"] != "win" {
		t.Fatalf("forfeit payload = %v（对方视角应为 win）", p)
	}
	winner := collectionEntryAtSeat(t, p, "results", 2)
	if p["winnerMemberId"] != winner["memberId"] || winner["result"] != "win" {
		t.Fatalf("winnerMemberId/results = %v / %v, want seat 2 winner", p["winnerMemberId"], winner)
	}
	// 成员行置 left 保留
	var status string
	if err := pool.QueryRow(ctx, "SELECT status FROM multi_member WHERE room_id = $1 AND seat = 1", fixture.roomID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "left" {
		t.Fatalf("host member status = %s, want left", status)
	}
	// left 成员在保留期内仍可只读拉取终态快照。
	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("left member snapshot status %d, want 200: %s", resp.StatusCode, payload)
	}
	var leftSnapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &leftSnapshot); err != nil {
		t.Fatal(err)
	}
	var leftEnded map[string]any
	for _, event := range leftSnapshot.Events {
		if event.Type == "match.ended" {
			leftEnded = event.Payload
		}
	}
	if leftEnded["viewerResult"] != "loss" || leftEnded["reason"] != "forfeit" {
		t.Fatalf("left member terminal event = %v", leftEnded)
	}
	// 写命令仍拒绝 left 令牌。
	resp, _ = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("left member rematch status %d, want 401", resp.StatusCode)
	}
}

func TestMultiDisconnectGrace(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	// joiner 断线且宽限逾期（直改 DB 模拟 Phase 4 的状态）
	if _, err := pool.Exec(ctx, `
		UPDATE multi_member SET status = 'disconnected', grace_until = now() - interval '1 second'
		WHERE room_id = $1 AND seat = 2`, fixture.roomID); err != nil {
		t.Fatal(err)
	}
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	events := eventsOf(t, fixture)
	var ended *openapi.RoomEventEnvelope
	for i := range events {
		if events[i].Type == "match.ended" {
			ended = &events[i]
		}
	}
	if ended == nil {
		t.Fatal("match.ended missing after disconnect")
	}
	if ended.Payload["reason"] != "disconnect" {
		t.Fatalf("reason = %v, want disconnect", ended.Payload["reason"])
	}
}

func TestMultiRestartTermination(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture) // round 已进入 playing

	terminated, err := multi.TerminateActiveMatches(ctx, pool, time.Now(), fastTiming)
	if err != nil {
		t.Fatal(err)
	}
	if terminated < 1 {
		t.Fatalf("terminated = %d, want >= 1", terminated)
	}
	events := eventsOf(t, fixture)
	var roundEnded, matchEnded bool
	for _, e := range events {
		switch e.Type {
		case "round.ended":
			roundEnded = true
			if e.Payload["viewerResult"] != "draw" {
				t.Fatalf("restart round viewerResult = %v, want draw", e.Payload["viewerResult"])
			}
		case "match.ended":
			matchEnded = true
			p := e.Payload
			if p["reason"] != "server_restart" || p["viewerResult"] != "draw" {
				t.Fatalf("restart match payload = %v", p)
			}
		}
	}
	if !roundEnded || !matchEnded {
		t.Fatalf("round.ended=%v match.ended=%v", roundEnded, matchEnded)
	}
	// 幂等：再次终止不再产生新事件
	before := len(eventsOf(t, fixture))
	if _, err := multi.TerminateActiveMatches(ctx, pool, time.Now(), fastTiming); err != nil {
		t.Fatal(err)
	}
	if after := len(eventsOf(t, fixture)); after != before {
		t.Fatalf("idempotent termination added events: %d -> %d", before, after)
	}
}

func TestMultiMetrics(t *testing.T) {
	// 指标计数随事件/连接/猜测正确变化（进程内读取验证，08 §11.2）
	before := multi.DefaultMetrics.Snapshot()
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	answer := currentAnswer(t, fixture.roomID)
	wrong := guessableIDs(t, answer, 1)[0]
	if resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, wrong, "metrics-guess"); resp.StatusCode != http.StatusOK {
		t.Fatalf("guess: %d %s", resp.StatusCode, payload)
	}
	after := multi.DefaultMetrics.Snapshot()
	events := after["eventsTotal"].(map[string]int64)
	for _, typ := range []string{"room.updated", "match.started", "round.started", "round.opponent.guess"} {
		if events[typ] <= before["eventsTotal"].(map[string]int64)[typ] {
			t.Fatalf("events_total[%s] 未增长: %d", typ, events[typ])
		}
	}
	latency, ok := after["guessLatency"].(map[string]time.Duration)
	if !ok || latency["count"] == 0 {
		t.Fatalf("guess_latency 未采样: %+v", after["guessLatency"])
	}
	rooms := after["roomsByStatus"].(map[string]int64)
	if rooms["playing"] == 0 {
		t.Fatalf("rooms{status=playing} 为 0: %+v", rooms)
	}
}

func TestMultiMetricsForfeit(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)
	if resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.hostToken, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave: %d %s", resp.StatusCode, payload)
	}
	after := multi.DefaultMetrics.Snapshot()
	forfeits := after["forfeitsTotal"].(map[string]int64)
	if forfeits["forfeit"] == 0 {
		t.Fatalf("forfeits_total{reason=forfeit} 为 0: %+v", forfeits)
	}
}

func TestMultiRematch(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	// bo3：host 赢两局结束对局
	for roundIndex := 1; roundIndex <= 2; roundIndex++ {
		answer := currentAnswer(t, fixture.roomID)
		resp, payload := guess(t, fixture.roomID, fixture.hostToken, roundIndex, answer, "rm-win-"+itoa(roundIndex))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("round %d status %d: %s", roundIndex, resp.StatusCode, payload)
		}
		if roundIndex == 1 {
			advanceRounds(t)
		}
	}

	// 单方 rematch → 等待态（match.rematch 事件，matchIndex 仍 0）
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host rematch: %d %s", resp.StatusCode, payload)
	}
	snap := startMatchSnapshot(t, fixture)
	if snap.Match == nil || snap.Match.MatchIndex != 0 {
		t.Fatalf("single rematch should not start new match: %+v", snap.Match)
	}

	// 双方 rematch → 新场行（matchIndex 1、比分清零、版本重绑）
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("joiner rematch: %d %s", resp.StatusCode, payload)
	}
	time.Sleep(10 * time.Millisecond)
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	snap = startMatchSnapshot(t, fixture)
	if snap.Status != openapi.RoomStatusPlaying {
		t.Fatalf("after rematch status = %s, want playing", snap.Status)
	}
	if snap.Match == nil || snap.Match.MatchIndex != 1 || len(snap.Match.Scores) != 2 || snap.Match.Scores[0].Score != 0 || snap.Match.Scores[1].Score != 0 {
		t.Fatalf("new match view = %+v, want matchIndex 1 score 0-0", snap.Match)
	}
	if snap.Round == nil {
		t.Fatal("new round missing")
	}
	// 比分/round_count 归零（直查 DB）
	var roundCount, score1 int32
	if err := pool.QueryRow(ctx, "SELECT round_count, score_slot1 FROM multi_match WHERE room_id = $1 ORDER BY match_index DESC LIMIT 1", fixture.roomID).Scan(&roundCount, &score1); err != nil {
		t.Fatal(err)
	}
	if roundCount != 1 || score1 != 0 {
		t.Fatalf("new match round_count=%d score1=%d", roundCount, score1)
	}
	// rematch_ready 已重置
	var rematchReady bool
	if err := pool.QueryRow(ctx, "SELECT rematch_ready FROM multi_member WHERE room_id = $1 AND seat = 1", fixture.roomID).Scan(&rematchReady); err != nil {
		t.Fatal(err)
	}
	if rematchReady {
		t.Fatal("rematch_ready not reset")
	}
}

func TestMultiFinishedLeaveRetainsRoom(t *testing.T) {
	fixture := createMatchFixtureFormat(t, "bo1")
	startMatch(t, fixture)

	// bo1 速胜结束
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "wait-leave-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("win: %d %s", resp.StatusCode, payload)
	}
	// host 确认 rematch，等待期 joiner 离开；finished 房间仍保留用于终态恢复/观战。
	resp, _ = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host rematch: %d", resp.StatusCode)
	}
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("joiner leave: %d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("retained snapshot: %d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Status != openapi.RoomStatusFinished {
		t.Fatalf("room status after finished leave = %s, want finished", snapshot.Status)
	}
	var status string
	if err := pool.QueryRow(ctx, "SELECT status FROM multi_member WHERE room_id = $1 AND seat = 2", fixture.roomID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != string(multi.MemberStatusLeft) {
		t.Fatalf("joiner status after leave = %s, want left", status)
	}
}
