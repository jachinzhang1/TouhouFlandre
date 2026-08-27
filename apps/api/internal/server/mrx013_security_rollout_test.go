package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/hub"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/assembly"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi/core"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

type mrx013QueryTracer struct {
	mu      sync.Mutex
	queries []string
}

func (t *mrx013QueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(strings.ToLower(data.SQL), "multi_relay_") {
		t.mu.Lock()
		t.queries = append(t.queries, data.SQL)
		t.mu.Unlock()
	}
	return ctx
}

func (*mrx013QueryTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

func (t *mrx013QueryTracer) relayQueries() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return append([]string(nil), t.queries...)
}

func TestMRX013RaceOnlyCreatePlaySnapshotDoesNotQueryRelayTables(t *testing.T) {
	registry, err := assembly.ForProfile(assembly.ProfileRaceOnly)
	if err != nil {
		t.Fatal(err)
	}
	tracer := &mrx013QueryTracer{}
	poolConfig, err := pgxpool.ParseConfig(pool.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	poolConfig.ConnConfig.Tracer = tracer
	tracedPool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatal(err)
	}
	defer tracedPool.Close()

	timing := fastTiming
	random := core.NewRandomSource()
	raceHub := hub.New(tracedPool, timing.DisconnectGrace, 4096, 64,
		[]byte("mrx013-race-projection-secret"), time.Hour,
		[]byte("mrx013-race-chat-secret"), registry)
	ts := httptest.NewServer(server.NewWithOptions(tracedPool,
		handler.WithHub(raceHub),
		handler.WithMultiTiming(timing),
		handler.WithJoinRateLimit(1000, time.Minute),
		handler.WithRolloutConfig(handler.RolloutConfig{NPlayerRaceEnabled: true, ChatSendEnabled: true}),
		handler.WithMultiplayerKernel(registry, core.SystemClock{}, random)))
	defer ts.Close()

	resp, payload := rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "relay", "playerLimit": 2,
	})
	if resp.StatusCode != http.StatusBadRequest || decodeError(t, payload).Code != "INVALID_REQUEST" {
		t.Fatalf("unregistered relay create=%d %s", resp.StatusCode, payload)
	}

	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "race", "playerLimit": 2,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("race create=%d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", "", map[string]string{})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("race join=%d %s", resp.StatusCode, payload)
	}
	var joined openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &joined); err != nil {
		t.Fatal(err)
	}
	for _, token := range []string{string(created.GuestToken), string(joined.GuestToken)} {
		resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms/"+created.RoomId+"/ready", token, map[string]bool{"ready": true})
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("race ready=%d %s", resp.StatusCode, payload)
		}
	}
	time.Sleep(10 * time.Millisecond)
	sweeper := multi.NewSweeper(tracedPool, multi.SweeperConfig{
		Timing: timing, EventRetention: time.Hour, Broadcaster: raceHub,
		Registry: registry, Clock: core.SystemClock{}, Random: random,
	})
	if err := sweeper.SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	var answer string
	if err := pool.QueryRow(ctx, `
		SELECT round.answer_id
		FROM multi_round AS round
		JOIN multi_match AS match ON match.id = round.match_id
		WHERE match.room_id = $1 AND round.status = 'playing'`, created.RoomId).Scan(&answer); err != nil {
		t.Fatal(err)
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost,
		"/api/rooms/"+created.RoomId+"/rounds/1/guess", string(created.GuestToken),
		map[string]string{"guessId": answer, "idempotencyKey": "mrx013-race-only"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("race guess=%d %s", resp.StatusCode, payload)
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodGet,
		"/api/rooms/"+created.RoomId+"/snapshot", string(created.GuestToken), nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("race snapshot=%d %s", resp.StatusCode, payload)
	}
	if queries := tracer.relayQueries(); len(queries) != 0 {
		t.Fatalf("race-only path queried relay-owned tables: %q", queries)
	}
	for _, ref := range []core.RuleSetRef{
		{Mode: core.ModeRace, Key: "wins", Version: 1},
		{Mode: core.ModeRace, Key: "points", Version: 1},
		{Mode: core.ModeRace, Key: "placement", Version: 1},
	} {
		driver, err := registry.RecoveryDriver(core.ModeRace)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := driver.Route(ref); err != nil {
			t.Fatalf("race recovery %s: %v", ref, err)
		}
	}
}

func TestMRX013RelayHistoryIsRateLimitedPerAuthenticatedMember(t *testing.T) {
	ts := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithJoinRateLimit(1000, time.Minute),
		handler.WithRelayHistoryRateLimit(1, time.Minute),
		handler.WithRolloutConfig(handler.RolloutConfig{NPlayerRelayEnabled: true, ChatSendEnabled: true})))
	defer ts.Close()

	resp, payload := rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "relay", "playerLimit": 2,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create relay=%d %s", resp.StatusCode, payload)
	}
	var created openapi.CreateRoomResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		t.Fatal(err)
	}
	path := "/api/rooms/" + created.RoomId + "/matches/0/stages"
	resp, _ = rolloutRequest(t, ts.Client(), ts.URL, http.MethodGet, path, string(created.GuestToken), nil)
	if resp.StatusCode == http.StatusTooManyRequests {
		t.Fatal("first history request was rate limited")
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodGet, path, string(created.GuestToken), nil)
	if resp.StatusCode != http.StatusTooManyRequests || decodeError(t, payload).Code != "RATE_LIMITED" {
		t.Fatalf("second history request=%d %s", resp.StatusCode, payload)
	}
}

func TestMRX013InternalErrorsDoNotExposePersistedDataInResponseOrLogs(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "race", 60)
	startMatch(t, fixture)
	const sentinel = "mrx013-unrevealed-answer-sentinel"
	if _, err := pool.Exec(ctx, `UPDATE multi_match SET rule_set_key = $2 WHERE room_id = $1`, fixture.roomID, sentinel); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `UPDATE multi_match SET rule_set_key = 'wins' WHERE room_id = $1`, fixture.roomID); err != nil {
			t.Errorf("restore rule set: %v", err)
		}
	})
	previousLogger := slog.Default()
	var logs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusInternalServerError || decodeError(t, payload).Code != "INTERNAL" {
		t.Fatalf("snapshot=%d %s", resp.StatusCode, payload)
	}
	if strings.Contains(string(payload), sentinel) || strings.Contains(logs.String(), sentinel) {
		t.Fatalf("internal persisted value leaked: response=%s logs=%s", payload, logs.String())
	}
}

func TestMRX013CrossRoomEncounterIDsAndActiveAnswersAreIsolated(t *testing.T) {
	primary := createRelayPolicyFixture(t, 4, false, 4)
	setRelayReady(t, primary)
	secondary := createRelayPolicyFixture(t, 2, false, 2)
	setRelayReady(t, secondary)

	primarySnapshot, _ := mrx013RelaySnapshot(t, primary.roomID, primary.tokens[0])
	secondarySnapshot, _ := mrx013RelaySnapshot(t, secondary.roomID, secondary.tokens[0])
	primaryDetails := *primarySnapshot.Match.Relay.CurrentStage.EncounterDetails
	secondaryDetails := *secondarySnapshot.Match.Relay.CurrentStage.EncounterDetails
	if len(primaryDetails) != 2 || len(secondaryDetails) != 1 {
		t.Fatalf("encounter counts primary=%d secondary=%d", len(primaryDetails), len(secondaryDetails))
	}
	first, active := primaryDetails[0], primaryDetails[1]
	if first.TurnMemberId == nil || active.TurnMemberId == nil {
		t.Fatalf("relay turns are missing: first=%+v active=%+v", first, active)
	}
	answers := mrx013EncounterAnswers(t, first.EncounterId, active.EncounterId)
	firstAnswer, activeAnswer := answers[first.EncounterId], answers[active.EncounterId]
	if firstAnswer == "" || activeAnswer == "" || firstAnswer == activeAnswer {
		t.Fatalf("stage answers are not distinct: first=%q active=%q", firstAnswer, activeAnswer)
	}

	tokenByMember := mrx013TokenByMember(t, primary.tokens)
	firstToken := tokenByMember[*first.TurnMemberId]
	if firstToken == "" {
		t.Fatalf("no token for first turn member %s", *first.TurnMemberId)
	}
	actionBody := map[string]string{"action": "pass", "idempotencyKey": "mrx013-isolation-probe"}
	actionBase := "/api/rooms/" + primary.roomID + "/stages/1/encounters/"

	resp, payload := fastRequestAuth(http.MethodPost, actionBase+active.EncounterId+"/actions", firstToken, actionBody)
	if resp.StatusCode != http.StatusConflict || decodeError(t, payload).Code != "NOT_ENCOUNTER_PLAYER" {
		t.Fatalf("cross-encounter action=%d %s", resp.StatusCode, payload)
	}
	if containsJSONValue(payload, firstAnswer) || containsJSONValue(payload, activeAnswer) {
		t.Fatalf("cross-encounter error leaked an answer: %s", payload)
	}
	resp, payload = fastRequestAuth(http.MethodPost,
		actionBase+secondaryDetails[0].EncounterId+"/actions", firstToken, actionBody)
	if resp.StatusCode != http.StatusNotFound || decodeError(t, payload).Code != "ENCOUNTER_NOT_FOUND" {
		t.Fatalf("cross-room encounter action=%d %s", resp.StatusCode, payload)
	}
	resp, payload = fastRequestAuth(http.MethodPost,
		"/api/rooms/"+primary.roomID+"/stages/2/encounters/"+first.EncounterId+"/actions", firstToken, actionBody)
	if resp.StatusCode != http.StatusNotFound || decodeError(t, payload).Code != "ENCOUNTER_NOT_FOUND" {
		t.Fatalf("stale stage action=%d %s", resp.StatusCode, payload)
	}

	ws := wsDial(t, primary.roomID, primary.tokens[0], 0, nil)
	drainUntilType(t, ws, "sync.complete", 32)
	previousLogger := slog.Default()
	var logs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })

	resp, payload = fastRequestAuth(http.MethodPost, actionBase+first.EncounterId+"/actions", firstToken, map[string]string{
		"action": "guess", "guessId": firstAnswer, "idempotencyKey": "mrx013-isolation-terminal",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("terminal first encounter=%d %s", resp.StatusCode, payload)
	}
	if containsJSONValue(payload, activeAnswer) {
		t.Fatalf("terminal action leaked the other active answer: %s", payload)
	}
	for frameIndex := 0; frameIndex < 16; frameIndex++ {
		frame := wsRead(t, ws)
		encoded, err := json.Marshal(frame)
		if err != nil {
			t.Fatal(err)
		}
		if containsJSONValue(encoded, activeAnswer) {
			t.Fatalf("WS frame leaked other active answer: %s", encoded)
		}
		if frame["type"] == "relay.encounter.ended" {
			break
		}
		if frameIndex == 15 {
			t.Fatalf("WS did not deliver relay.encounter.ended")
		}
	}

	terminalSnapshot, _ := mrx013RelaySnapshot(t, primary.roomID, primary.tokens[0])
	terminalDetails := *terminalSnapshot.Match.Relay.CurrentStage.EncounterDetails
	byID := make(map[string]openapi.RelayEncounterView, len(terminalDetails))
	for _, detail := range terminalDetails {
		byID[detail.EncounterId] = detail
	}
	if byID[first.EncounterId].Answer == nil || byID[first.EncounterId].Answer.Id != firstAnswer {
		t.Fatalf("terminal encounter answer=%+v want=%s", byID[first.EncounterId].Answer, firstAnswer)
	}
	if byID[active.EncounterId].Answer != nil {
		t.Fatalf("other active encounter leaked answer=%+v", byID[active.EncounterId].Answer)
	}

	resp, historyPayload := fastRequestAuth(http.MethodGet,
		"/api/rooms/"+primary.roomID+"/matches/0/stages", primary.tokens[0], nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("partial-stage history=%d %s", resp.StatusCode, historyPayload)
	}
	if containsJSONValue(historyPayload, activeAnswer) {
		t.Fatalf("history leaked active answer: %s", historyPayload)
	}
	var eventPayloads string
	if err := pool.QueryRow(ctx, `
		SELECT coalesce(jsonb_agg(payload ORDER BY sequence), '[]'::jsonb)::text
		FROM room_event WHERE room_id = $1 AND type LIKE 'relay.%'`, primary.roomID).Scan(&eventPayloads); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(eventPayloads, activeAnswer) {
		t.Fatalf("stored WS event leaked active answer: %s", eventPayloads)
	}
	resp, metricsPayload := request(http.MethodGet, "/metrics", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("metrics=%d %s", resp.StatusCode, metricsPayload)
	}
	if strings.Contains(string(metricsPayload), activeAnswer) || strings.Contains(logs.String(), activeAnswer) {
		t.Fatalf("active answer leaked to metrics or logs: metrics=%s logs=%s", metricsPayload, logs.String())
	}
}

func TestMRX013RelayFlagsBlockNewConfigurationAndGrandfatherPlayingMatch(t *testing.T) {
	disabled := handler.RolloutConfig{NPlayerRaceEnabled: true, ChatSendEnabled: true}
	ts := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithJoinRateLimit(1000, time.Minute),
		handler.WithRolloutConfig(disabled)))
	defer ts.Close()

	resp, payload := rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "relay", "playerLimit": 4,
	})
	if resp.StatusCode != http.StatusForbidden || decodeError(t, payload).Code != "FEATURE_DISABLED" {
		t.Fatalf("disabled N-player relay create=%d %s", resp.StatusCode, payload)
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "relay", "playerLimit": 2,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("legacy relay create=%d %s", resp.StatusCode, payload)
	}
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, "/api/rooms", "", map[string]any{
		"format": "bo1", "mode": "race", "playerLimit": 4,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("race create with relay flags disabled=%d %s", resp.StatusCode, payload)
	}

	fixture := createRelayPolicyFixture(t, 4, false, 4)
	setRelayReady(t, fixture)
	time.Sleep(10 * time.Millisecond)
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodGet,
		"/api/rooms/"+fixture.roomID+"/snapshot", fixture.tokens[0], nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grandfather snapshot=%d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	details := *snapshot.Match.Relay.CurrentStage.EncounterDetails
	if len(details) == 0 || details[0].TurnMemberId == nil {
		t.Fatalf("grandfather relay details=%+v", details)
	}
	var token string
	for _, candidate := range fixture.tokens {
		var memberID string
		if err := pool.QueryRow(ctx, `SELECT id FROM multi_member WHERE token_hash = $1`, multi.HashToken(candidate)).Scan(&memberID); err != nil {
			t.Fatal(err)
		}
		if memberID == *details[0].TurnMemberId {
			token = candidate
			break
		}
	}
	if token == "" {
		t.Fatal("turn member token not found")
	}
	actionPath := "/api/rooms/" + fixture.roomID + "/stages/1/encounters/" + details[0].EncounterId + "/actions"
	resp, payload = rolloutRequest(t, ts.Client(), ts.URL, http.MethodPost, actionPath, token, map[string]string{
		"action": "pass", "idempotencyKey": "mrx013-grandfather-pass",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("grandfather action=%d %s", resp.StatusCode, payload)
	}
}

func TestMRX013MetricsEndpointIsPrometheusCompatibleAndContainsNoIdentifiers(t *testing.T) {
	resp, payload := request(http.MethodGet, "/metrics", nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("metrics=%d %s", resp.StatusCode, payload)
	}
	if contentType := resp.Header.Get("Content-Type"); !strings.Contains(contentType, "text/plain") {
		t.Fatalf("metrics content type=%q", contentType)
	}
	text := string(payload)
	for _, metric := range []string{
		"touhouflandre_multi_active_encounters",
		"touhouflandre_multi_guess_latency_seconds",
		"touhouflandre_multi_history_latency_seconds",
		"touhouflandre_multi_snapshot_bytes",
		"touhouflandre_multi_ws_payload_bytes",
	} {
		if !strings.Contains(text, "# TYPE "+metric) {
			t.Fatalf("metrics endpoint missing %s", metric)
		}
	}
	if strings.Contains(text, "guest:") || strings.Contains(text, "token_hash") {
		t.Fatalf("metrics endpoint leaked credential material: %s", text)
	}
}

func mrx013RelaySnapshot(t *testing.T, roomID, token string) (openapi.RoomSnapshot, []byte) {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+roomID+"/snapshot", token, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("relay snapshot=%d %s", resp.StatusCode, payload)
	}
	var snapshot openapi.RoomSnapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Match == nil || snapshot.Match.Relay == nil || snapshot.Match.Relay.CurrentStage == nil ||
		snapshot.Match.Relay.CurrentStage.EncounterDetails == nil {
		t.Fatalf("relay snapshot has no current encounter details: %+v", snapshot.Match)
	}
	return snapshot, payload
}

func mrx013EncounterAnswers(t *testing.T, encounterIDs ...string) map[string]string {
	t.Helper()
	rows, err := pool.Query(ctx, `
		SELECT id, answer_id FROM multi_relay_encounter WHERE id = ANY($1::text[])`, encounterIDs)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	answers := make(map[string]string, len(encounterIDs))
	for rows.Next() {
		var encounterID, answerID string
		if err := rows.Scan(&encounterID, &answerID); err != nil {
			t.Fatal(err)
		}
		answers[encounterID] = answerID
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return answers
}

func mrx013TokenByMember(t *testing.T, tokens []string) map[string]string {
	t.Helper()
	tokenByMember := make(map[string]string, len(tokens))
	for _, token := range tokens {
		var memberID string
		if err := pool.QueryRow(ctx, `SELECT id FROM multi_member WHERE token_hash = $1`, multi.HashToken(token)).Scan(&memberID); err != nil {
			t.Fatal(err)
		}
		tokenByMember[memberID] = token
	}
	return tokenByMember
}
