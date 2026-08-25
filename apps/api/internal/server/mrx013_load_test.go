package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/handler"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/server"
)

type mrx013LatencySample struct {
	duration time.Duration
	status   int
	payload  []byte
}

func mrx013Percentile(samples []time.Duration, percentile float64) time.Duration {
	sorted := append([]time.Duration(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	if len(sorted) == 0 {
		return 0
	}
	index := int(float64(len(sorted)-1) * percentile)
	return sorted[index]
}

func mrx013DatabaseDeadlocks(t *testing.T) int64 {
	t.Helper()
	var deadlocks int64
	if err := pool.QueryRow(ctx, `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database()`).Scan(&deadlocks); err != nil {
		t.Fatal(err)
	}
	return deadlocks
}

func TestMRX013EightPlayerConcurrentEncounterLoadProfile(t *testing.T) {
	deadlocksBefore := mrx013DatabaseDeadlocks(t)
	fixture := createRelayPolicyFixture(t, 8, false, 8)
	var spectatorToken string
	for index := 0; index < 32; index++ {
		resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.code+"/join", map[string]string{
			"displayName": fmt.Sprintf("Load Spectator %02d", index+1),
		})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("spectator %d join=%d %s", index+1, resp.StatusCode, payload)
		}
		var joined openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &joined); err != nil {
			t.Fatal(err)
		}
		if joined.JoinRole != openapi.ParticipantRoleSpectator {
			t.Fatalf("spectator %d role=%s", index+1, joined.JoinRole)
		}
		if index == 0 {
			spectatorToken = string(joined.GuestToken)
		}
	}
	setRelayReady(t, fixture)
	time.Sleep(10 * time.Millisecond)

	tokenByMemberID := make(map[string]string, len(fixture.tokens))
	for _, token := range fixture.tokens {
		var memberID string
		if err := pool.QueryRow(ctx, `SELECT id FROM multi_member WHERE token_hash = $1`, multi.HashToken(token)).Scan(&memberID); err != nil {
			t.Fatal(err)
		}
		tokenByMemberID[memberID] = token
	}

	latencies := make([]time.Duration, 0, 20)
	for wave := 1; wave <= 5; wave++ {
		rows, err := pool.Query(ctx, `
			SELECT encounter.id, encounter.turn_member_id
			FROM multi_relay_encounter AS encounter
			JOIN multi_match AS match ON match.id = encounter.match_id
			WHERE match.room_id = $1 AND match.status = 'playing' AND encounter.status <> 'ended'
			ORDER BY encounter.encounter_index`, fixture.roomID)
		if err != nil {
			t.Fatal(err)
		}
		type target struct{ encounterID, memberID string }
		var targets []target
		for rows.Next() {
			var current target
			if err := rows.Scan(&current.encounterID, &current.memberID); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			targets = append(targets, current)
		}
		rows.Close()
		if len(targets) != 4 {
			t.Fatalf("wave %d active encounters=%d, want 4", wave, len(targets))
		}

		start := make(chan struct{})
		results := make(chan mrx013LatencySample, len(targets))
		var group sync.WaitGroup
		for index, target := range targets {
			target := target
			group.Add(1)
			go func(index int) {
				defer group.Done()
				<-start
				started := time.Now()
				path := fmt.Sprintf("/api/rooms/%s/stages/1/encounters/%s/actions", fixture.roomID, target.encounterID)
				resp, payload := fastRequestAuth(http.MethodPost, path, tokenByMemberID[target.memberID], map[string]string{
					"action": "pass", "idempotencyKey": fmt.Sprintf("mrx013-load-%d-%d", wave, index),
				})
				results <- mrx013LatencySample{duration: time.Since(started), status: resp.StatusCode, payload: payload}
			}(index)
		}
		close(start)
		group.Wait()
		close(results)
		for result := range results {
			if result.status != http.StatusOK {
				t.Fatalf("wave %d action=%d %s", wave, result.status, result.payload)
			}
			latencies = append(latencies, result.duration)
		}
	}

	p95 := mrx013Percentile(latencies, 0.95)
	p99 := mrx013Percentile(latencies, 0.99)
	t.Logf("MRX-013 8-player concurrent actions: samples=%d p95=%s p99=%s", len(latencies), p95, p99)
	if p95 > 2*time.Second || p99 > 3*time.Second {
		t.Fatalf("concurrent action latency exceeded local rollout threshold: p95=%s p99=%s", p95, p99)
	}

	var stageCount, settledStages, settlementRows, stageEndedEvents, spectatorCount int
	if err := pool.QueryRow(ctx, `
		SELECT
		  (SELECT count(*)::int FROM multi_relay_stage AS stage JOIN multi_match AS match ON match.id = stage.match_id WHERE match.room_id = $1),
		  (SELECT count(*)::int FROM multi_relay_stage AS stage JOIN multi_match AS match ON match.id = stage.match_id WHERE match.room_id = $1 AND stage.settlement_marker IS NOT NULL),
		  (SELECT count(*)::int FROM multi_relay_stage_player AS player JOIN multi_match AS match ON match.id = player.match_id WHERE match.room_id = $1),
		  (SELECT count(*)::int FROM room_event WHERE room_id = $1 AND type = 'relay.stage.ended'),
		  (SELECT count(*)::int FROM multi_member WHERE room_id = $1 AND role = 'spectator')`, fixture.roomID).
		Scan(&stageCount, &settledStages, &settlementRows, &stageEndedEvents, &spectatorCount); err != nil {
		t.Fatal(err)
	}
	if stageCount != 1 || settledStages != 1 || settlementRows != 8 || stageEndedEvents != 1 || spectatorCount != 32 {
		t.Fatalf("stage=%d settled=%d rows=%d events=%d spectators=%d", stageCount, settledStages, settlementRows, stageEndedEvents, spectatorCount)
	}
	if deadlocksAfter := mrx013DatabaseDeadlocks(t); deadlocksAfter != deadlocksBefore {
		t.Fatalf("database deadlocks changed %d -> %d", deadlocksBefore, deadlocksAfter)
	}
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", spectatorToken, nil)
	if resp.StatusCode != http.StatusOK || len(payload) > 512*1024 {
		t.Fatalf("spectator snapshot=%d bytes=%d %s", resp.StatusCode, len(payload), payload)
	}
}

func TestMRX013HundredStageHistoryLoadProfile(t *testing.T) {
	fixture := createRelayPolicyFixture(t, 2, false, 2)
	setRelayReady(t, fixture)
	var matchID, stageOneID, encounterOneID, answerID string
	if err := pool.QueryRow(ctx, `
		SELECT match.id, stage.id, encounter.id, encounter.answer_id
		FROM multi_match AS match
		JOIN multi_relay_stage AS stage ON stage.match_id = match.id
		JOIN multi_relay_encounter AS encounter ON encounter.stage_id = stage.id
		WHERE match.room_id = $1`, fixture.roomID).Scan(&matchID, &stageOneID, &encounterOneID, &answerID); err != nil {
		t.Fatal(err)
	}
	type player struct {
		id   string
		seat int
	}
	rows, err := pool.Query(ctx, `SELECT member_id, seat FROM multi_match_player WHERE match_id = $1 ORDER BY seat`, matchID)
	if err != nil {
		t.Fatal(err)
	}
	var players []player
	for rows.Next() {
		var current player
		if err := rows.Scan(&current.id, &current.seat); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		players = append(players, current)
	}
	rows.Close()
	if len(players) != 2 {
		t.Fatalf("history players=%d", len(players))
	}

	now := time.Now().UTC()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		UPDATE multi_relay_encounter
		SET status='ended', turn_member_id=NULL, turn_deadline=NULL, winner_member_id=$2,
		    outcome='win', ended_at=$3
		WHERE id=$1`, encounterOneID, players[0].id, now); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE multi_relay_stage SET status='ended', settled_at=$2, settlement_marker=$3 WHERE id=$1`,
		stageOneID, now, "mrx013-history-marker-001-"+matchID); err != nil {
		t.Fatal(err)
	}
	for index, current := range players {
		outcome := "loss"
		delta := 0
		if index == 0 {
			outcome, delta = "win", 1
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO multi_relay_stage_player
			(match_id, stage_id, member_id, encounter_id, assignment, outcome, score_before, score_delta, score_after, life_before, life_after, settled_at)
			VALUES ($1,$2,$3,$4,'paired',$5,0,$6,$6,'healthy','healthy',$7)`,
			matchID, stageOneID, current.id, encounterOneID, outcome, delta, now); err != nil {
			t.Fatal(err)
		}
	}
	stageIDs := []string{stageOneID}
	encounterIDs := []string{encounterOneID}
	for stageIndex := 2; stageIndex <= 100; stageIndex++ {
		stageID := fmt.Sprintf("mrx013-history-stage-%03d-%s", stageIndex, matchID)
		encounterID := fmt.Sprintf("mrx013-history-encounter-%03d-%s", stageIndex, matchID)
		stageIDs = append(stageIDs, stageID)
		encounterIDs = append(encounterIDs, encounterID)
		stageTime := now.Add(time.Duration(stageIndex) * time.Second)
		if _, err := tx.Exec(ctx, `
			INSERT INTO multi_relay_stage
			(id, match_id, stage_index, status, planned_encounter_count, starts_at, settled_at, settlement_marker)
			VALUES ($1,$2,$3,'ended',1,$4,$4,$5)`, stageID, matchID, stageIndex, stageTime,
			fmt.Sprintf("mrx013-history-marker-%03d-%s", stageIndex, matchID)); err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO multi_relay_encounter
			(id, match_id, stage_id, encounter_index, status, answer_id, starts_at, deadline, winner_member_id, outcome, ended_at)
			VALUES ($1,$2,$3,1,'ended',$4,$5,$6,$7,'win',$6)`,
			encounterID, matchID, stageID, answerID, stageTime.Add(-time.Second), stageTime, players[0].id); err != nil {
			t.Fatal(err)
		}
		for side, current := range players {
			if _, err := tx.Exec(ctx, `
				INSERT INTO multi_relay_encounter_member (match_id, stage_id, encounter_id, member_id, side, seat)
				VALUES ($1,$2,$3,$4,$5,$6)`, matchID, stageID, encounterID, current.id, side+1, current.seat); err != nil {
				t.Fatal(err)
			}
			outcome := "loss"
			delta := 0
			if side == 0 {
				outcome, delta = "win", 1
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO multi_relay_stage_player
				(match_id, stage_id, member_id, encounter_id, assignment, outcome, score_before, score_delta, score_after, life_before, life_after, settled_at)
				VALUES ($1,$2,$3,$4,'paired',$5,0,$6,$6,'healthy','healthy',$7)`,
				matchID, stageID, current.id, encounterID, outcome, delta, stageTime); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := tx.Exec(ctx, `UPDATE multi_match SET status='finished', round_count=100, ended_at=$2 WHERE id=$1`, matchID, now.Add(101*time.Second)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `UPDATE multi_room SET status='finished', expires_at=$2 WHERE id=$1`, fixture.roomID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	historyServer := httptest.NewServer(server.NewWithOptions(pool,
		handler.WithJoinRateLimit(10000, time.Minute),
		handler.WithRelayHistoryRateLimit(10000, time.Minute),
		handler.WithRolloutConfig(handler.RolloutConfig{NPlayerRelayEnabled: true, RelayEliminationEnabled: true, ChatSendEnabled: true})))
	defer historyServer.Close()
	snapshotPath := "/api/rooms/" + fixture.roomID + "/snapshot"
	resp, baselineSnapshot := rolloutRequest(t, historyServer.Client(), historyServer.URL, http.MethodGet, snapshotPath, fixture.tokens[0], nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("baseline history snapshot=%d %s", resp.StatusCode, baselineSnapshot)
	}

	tx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for stageOffset, encounterID := range encounterIDs {
		for turnIndex := 1; turnIndex <= 20; turnIndex++ {
			current := players[(turnIndex-1)%2]
			if _, err := tx.Exec(ctx, `
				INSERT INTO multi_relay_turn
				(id, match_id, stage_id, encounter_id, member_id, turn_index, kind, idempotency_key)
				VALUES ($1,$2,$3,$4,$5,$6,'pass',$7)`,
				fmt.Sprintf("mrx013-history-turn-%03d-%02d-%s", stageOffset+1, turnIndex, matchID),
				matchID, stageIDs[stageOffset], encounterID, current.id, turnIndex,
				fmt.Sprintf("mrx013-history-idem-%03d-%02d", stageOffset+1, turnIndex)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	var snapshotLatencies []time.Duration
	var snapshotPayload []byte
	for index := 0; index < 10; index++ {
		started := time.Now()
		resp, snapshotPayload = rolloutRequest(t, historyServer.Client(), historyServer.URL, http.MethodGet, snapshotPath, fixture.tokens[0], nil)
		snapshotLatencies = append(snapshotLatencies, time.Since(started))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("history snapshot %d=%d %s", index, resp.StatusCode, snapshotPayload)
		}
	}
	// A finished snapshot keeps the final stage's one-board detail. The other
	// 99 stages remain summaries, so 2000 stored turns may grow the payload by
	// at most one stage rather than by the complete history.
	if growth := len(snapshotPayload) - len(baselineSnapshot); growth < 0 || growth > 32*1024 {
		t.Fatalf("snapshot growth was not bounded to one stage: %d -> %d bytes", len(baselineSnapshot), len(snapshotPayload))
	}
	if len(snapshotPayload) > 512*1024 {
		t.Fatalf("100-stage snapshot=%d bytes, want <= 512KiB", len(snapshotPayload))
	}

	historyPath := "/api/rooms/" + fixture.roomID + "/matches/0/stages?limit=20"
	var historyLatencies []time.Duration
	var firstPage []byte
	for index := 0; index < 20; index++ {
		started := time.Now()
		resp, firstPage = rolloutRequest(t, historyServer.Client(), historyServer.URL, http.MethodGet, historyPath, fixture.tokens[0], nil)
		historyLatencies = append(historyLatencies, time.Since(started))
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("history page %d=%d %s", index, resp.StatusCode, firstPage)
		}
	}
	var page openapi.RoomsListRelayStageHistory200JSONResponse
	if err := json.Unmarshal(firstPage, &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Stages) != 20 || page.NextCursor == nil || len(page.Stages[0].Encounters[0].Rows) != 20 {
		t.Fatalf("history page stages=%d cursor=%v first rows=%d", len(page.Stages), page.NextCursor, len(page.Stages[0].Encounters[0].Rows))
	}
	oldPath := historyPath + "&after=" + url.QueryEscape(*page.NextCursor)
	resp, oldPage := rolloutRequest(t, historyServer.Client(), historyServer.URL, http.MethodGet, oldPath, fixture.tokens[0], nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("old history page=%d %s", resp.StatusCode, oldPage)
	}
	if len(firstPage) > 512*1024 || len(oldPage) > 512*1024 {
		t.Fatalf("history payloads too large: first=%d old=%d", len(firstPage), len(oldPage))
	}
	historyP95 := mrx013Percentile(historyLatencies, 0.95)
	historyP99 := mrx013Percentile(historyLatencies, 0.99)
	snapshotP95 := mrx013Percentile(snapshotLatencies, 0.95)
	snapshotP99 := mrx013Percentile(snapshotLatencies, 0.99)
	t.Logf("MRX-013 100-stage/2000-turn fixture: snapshot=%dB p95=%s p99=%s history=%dB p95=%s p99=%s",
		len(snapshotPayload), snapshotP95, snapshotP99, len(firstPage), historyP95, historyP99)
	if historyP95 > 1500*time.Millisecond {
		t.Fatalf("history p95=%s exceeds rollout threshold", historyP95)
	}
}
