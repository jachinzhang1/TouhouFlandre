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

// fastSweeper 与 fast server 同时间常量的 sweeper（测试手动驱动）。
func fastSweeper() *multi.Sweeper {
	return multi.NewSweeper(pool, multi.SweeperConfig{Timing: fastTiming, EventRetention: time.Hour})
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

// matchFixture 双人房间夹具（host 为房主 slot1，joiner slot2）。
type matchFixture struct {
	roomID      string
	roomCode    string
	hostToken   string
	joinerToken string
}

// createMatchFixture 创建 bo3 双人房间（fast server）。
func createMatchFixture(t *testing.T) matchFixture {
	t.Helper()
	return createMatchFixtureFormat(t, "bo3")
}

// createMatchFixtureFormat 以指定赛制创建双人房间（fast server）。
func createMatchFixtureFormat(t *testing.T, format string) matchFixture {
	t.Helper()
	resp, payload := fastRequest(http.MethodPost, "/api/rooms", map[string]string{"format": format})
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
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", token, nil)
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
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.hostToken, nil)
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
	if len(snap.Events) < 2 {
		t.Fatalf("expected match.started + round.started events, got %d", len(snap.Events))
	}

	// 对局已开始后的重复 ready → MATCH_ALREADY_STARTED
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/ready", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("repeat ready status %d: %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "MATCH_ALREADY_STARTED" {
		t.Fatalf("want MATCH_ALREADY_STARTED, got %s", err.Code)
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
	if payloadMap["result"] != "win" {
		t.Fatalf("round.ended result = %v, want win", payloadMap["result"])
	}
	answerView, _ := payloadMap["answer"].(map[string]any)
	if answerView["name"] == "" || answerView["avatarUrl"] == "" {
		t.Fatalf("round.ended answer not revealed: %v", payloadMap["answer"])
	}
	scores, _ := payloadMap["scores"].(map[string]any)
	if scores["slot1"] != float64(1) || scores["slot2"] != float64(0) {
		t.Fatalf("round.ended scores = %v", scores)
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
		WHERE m.room_id = $1 AND g.member_id = (SELECT id FROM multi_member WHERE room_id = $1 AND slot = 1)`,
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
	if ended.Payload["result"] != "draw" {
		t.Fatalf("draw result = %v", ended.Payload["result"])
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
	if p["reason"] != "normal" || p["result"] != "win" {
		t.Fatalf("match.ended payload = %v", p)
	}
	scores := p["scores"].(map[string]any)
	if scores["slot1"] != float64(2) || scores["slot2"] != float64(0) {
		t.Fatalf("final scores = %v", scores)
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

func TestMultiForfeit(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("forfeit leave: %d %s", resp.StatusCode, payload)
	}
	// 弃赛者令牌已撤销（成员行 left，§6.2），由对方拉取结果
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
	if p["reason"] != "forfeit" || p["result"] != "win" {
		t.Fatalf("forfeit payload = %v（对方视角应为 win）", p)
	}
	if p["winnerSlot"] != float64(2) {
		t.Fatalf("winnerSlot = %v, want 2", p["winnerSlot"])
	}
	// 成员行置 left 保留
	var status string
	if err := pool.QueryRow(ctx, "SELECT status FROM multi_member WHERE room_id = $1 AND slot = 1", fixture.roomID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "left" {
		t.Fatalf("host member status = %s, want left", status)
	}
	// 弃赛者令牌已撤销
	resp, payload = fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("left member snapshot status %d, want 401", resp.StatusCode)
	}
}

func TestMultiDisconnectGrace(t *testing.T) {
	fixture := createMatchFixture(t)
	startMatch(t, fixture)

	// joiner 断线且宽限逾期（直改 DB 模拟 Phase 4 的状态）
	if _, err := pool.Exec(ctx, `
		UPDATE multi_member SET status = 'disconnected', grace_until = now() - interval '1 second'
		WHERE room_id = $1 AND slot = 2`, fixture.roomID); err != nil {
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
			if e.Payload["result"] != "draw" {
				t.Fatalf("restart round result = %v, want draw", e.Payload["result"])
			}
		case "match.ended":
			matchEnded = true
			p := e.Payload
			if p["reason"] != "server_restart" || p["result"] != "draw" {
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
	if snap.Match == nil || snap.Match.MatchIndex != 1 || snap.Match.ScoreSlot1 != 0 || snap.Match.ScoreSlot2 != 0 {
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
	if err := pool.QueryRow(ctx, "SELECT rematch_ready FROM multi_member WHERE room_id = $1 AND slot = 1", fixture.roomID).Scan(&rematchReady); err != nil {
		t.Fatal(err)
	}
	if rematchReady {
		t.Fatal("rematch_ready not reset")
	}
}

func TestMultiRematchWaitLeaveClosesRoom(t *testing.T) {
	fixture := createMatchFixtureFormat(t, "bo1")
	startMatch(t, fixture)

	// bo1 速胜结束
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "wait-leave-win")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("win: %d %s", resp.StatusCode, payload)
	}
	// host 确认 rematch，等待期 joiner 离开 → 房间关闭
	resp, _ = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host rematch: %d", resp.StatusCode)
	}
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.joinerToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("joiner leave: %d %s", resp.StatusCode, payload)
	}
	// 房间已关闭 → rematch ROOM_CLOSED
	resp, payload = fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rematch", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("rematch on closed: %d %s", resp.StatusCode, payload)
	}
	if err := decodeError(t, payload); err.Code != "ROOM_CLOSED" {
		t.Fatalf("want ROOM_CLOSED, got %s", err.Code)
	}
}
