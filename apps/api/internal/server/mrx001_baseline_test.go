package server_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"testing"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
)

func TestMRX001LegacyRelayFormats(t *testing.T) {
	cases := []struct {
		format     string
		rounds     int
		targetWins int
		maxRounds  int
	}{
		{format: "bo1", rounds: 1, targetWins: 1, maxRounds: 3},
		{format: "bo3", rounds: 3, targetWins: 2, maxRounds: 9},
		{format: "bo5", rounds: 5, targetWins: 3, maxRounds: 15},
		{format: "bo7", rounds: 7, targetWins: 4, maxRounds: 21},
	}

	for _, test := range cases {
		t.Run(test.format, func(t *testing.T) {
			fixture := createMatchFixtureMode(t, test.format, "relay", 30)
			snapshot := startMatch(t, fixture)
			if snapshot.Match == nil || snapshot.Match.TargetWins != test.targetWins ||
				snapshot.Match.MaxRounds != test.maxRounds || snapshot.Match.ScoringMode != openapi.Wins ||
				snapshot.Match.RosterSize != 2 {
				t.Fatalf("%s frozen match contract = %+v", test.format, snapshot.Match)
			}

			for roundIndex := 1; roundIndex <= test.rounds; roundIndex++ {
				wantFirstSeat := 1
				token := fixture.hostToken
				if roundIndex%2 == 0 {
					wantFirstSeat = 2
					token = fixture.joinerToken
				}
				if snapshot.Round == nil || snapshot.Round.TurnSeat == nil || *snapshot.Round.TurnSeat != wantFirstSeat {
					t.Fatalf("%s round %d first seat = %+v, want %d", test.format, roundIndex, snapshot.Round, wantFirstSeat)
				}

				answer := currentAnswer(t, fixture.roomID)
				resp, payload := guess(t, fixture.roomID, token, roundIndex, answer,
					"mrx001-"+test.format+"-round-"+strconv.Itoa(roundIndex))
				if resp.StatusCode != http.StatusOK {
					t.Fatalf("%s round %d winning guess = %d %s", test.format, roundIndex, resp.StatusCode, payload)
				}
				if roundIndex < test.rounds {
					advanceRounds(t)
					snapshot = startMatchSnapshot(t, fixture)
				}
			}

			var status string
			var roundCount, scoreSlot1, scoreSlot2 int
			var seat1Won bool
			if err := pool.QueryRow(ctx, `
				SELECT match.status, match.round_count, match.score_slot1, match.score_slot2,
				       match.winner_member_id = member.id
				FROM multi_match AS match
				JOIN multi_member AS member ON member.room_id = match.room_id AND member.seat = 1
				WHERE match.room_id = $1`, fixture.roomID).
				Scan(&status, &roundCount, &scoreSlot1, &scoreSlot2, &seat1Won); err != nil {
				t.Fatal(err)
			}
			if status != "finished" || roundCount != test.rounds || scoreSlot1 != test.targetWins ||
				scoreSlot2 != test.targetWins-1 || !seat1Won {
				t.Fatalf("%s final status=%s rounds=%d score=%d:%d seat1Won=%t",
					test.format, status, roundCount, scoreSlot1, scoreSlot2, seat1Won)
			}
		})
	}
}

func TestMRX001LegacyRelayActions(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo3", "relay", 30)
	startMatch(t, fixture)

	resp, payload := fastRequestAuth(http.MethodPost,
		"/api/rooms/"+fixture.roomID+"/rounds/1/pass", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("relay pass = %d %s", resp.StatusCode, payload)
	}
	if _, err := pool.Exec(ctx, `
		UPDATE multi_relay_encounter AS encounter
		SET turn_deadline = now() - interval '1 second'
		FROM multi_relay_stage AS stage, multi_match AS match
		WHERE encounter.stage_id = stage.id AND encounter.match_id = match.id
		  AND match.room_id = $1 AND stage.stage_index = 1`, fixture.roomID); err != nil {
		t.Fatal(err)
	}

	answer := currentAnswer(t, fixture.roomID)
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "mrx001-relay-after-timeout")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("relay guess after timeout = %d %s", resp.StatusCode, payload)
	}

	type turnRow struct {
		kind string
		seat int
	}
	rows, err := pool.Query(ctx, `
		SELECT turn.kind, member.seat
		FROM multi_relay_turn AS turn
		JOIN multi_relay_stage AS stage ON stage.id = turn.stage_id
		JOIN multi_match AS match ON match.id = turn.match_id
		JOIN multi_member AS member ON member.id = turn.member_id
		WHERE match.room_id = $1 AND stage.stage_index = 1
		ORDER BY turn.turn_index`, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	var turns []turnRow
	for rows.Next() {
		var row turnRow
		if err := rows.Scan(&row.kind, &row.seat); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		turns = append(turns, row)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	rows.Close()
	wantTurns := []turnRow{{kind: "pass", seat: 1}, {kind: "timeout", seat: 2}, {kind: "guess", seat: 1}}
	if len(turns) != len(wantTurns) {
		t.Fatalf("relay characteristic turns = %+v, want %+v", turns, wantTurns)
	}
	for index := range wantTurns {
		if turns[index] != wantTurns[index] {
			t.Fatalf("relay characteristic turns = %+v, want %+v", turns, wantTurns)
		}
	}

	advanceRounds(t)
	snapshot := startMatchSnapshot(t, fixture)
	if snapshot.Round == nil || snapshot.Round.TurnSeat == nil || *snapshot.Round.TurnSeat != 2 {
		t.Fatalf("relay round 2 first turn = %+v, want seat 2", snapshot.Round)
	}
	resp, payload = fastRequestAuth(http.MethodPost,
		"/api/rooms/"+fixture.roomID+"/rounds/2/forfeit", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("relay round forfeit = %d %s", resp.StatusCode, payload)
	}

	var matchStatus, roundStatus string
	var scoreSlot1, scoreSlot2, winnerSlot int
	if err := pool.QueryRow(ctx, `
		SELECT match.status, match.score_slot1, match.score_slot2, encounter.status, member.seat
		FROM multi_match AS match
		JOIN multi_relay_stage AS stage ON stage.match_id = match.id AND stage.stage_index = 2
		JOIN multi_relay_encounter AS encounter ON encounter.stage_id = stage.id
		JOIN multi_relay_encounter_member AS member
		  ON member.encounter_id = encounter.id AND member.member_id = encounter.winner_member_id
		WHERE match.room_id = $1`, fixture.roomID).
		Scan(&matchStatus, &scoreSlot1, &scoreSlot2, &roundStatus, &winnerSlot); err != nil {
		t.Fatal(err)
	}
	if matchStatus != "playing" || scoreSlot1 != 1 || scoreSlot2 != 1 || roundStatus != "ended" || winnerSlot != 2 {
		t.Fatalf("relay forfeit result match=%s score=%d:%d round=%s winnerSeat=%d",
			matchStatus, scoreSlot1, scoreSlot2, roundStatus, winnerSlot)
	}
}

func TestMRX001NormalizedContractFixtures(t *testing.T) {
	fixture := createNPlayerRaceFixture(t, 4, "bo3", false)
	snapshot := fixture.snapshot
	if snapshot.Match == nil || snapshot.Round == nil || snapshot.Round.Self.Seat == nil {
		t.Fatalf("normalized fixture requires an active player snapshot: %+v", snapshot)
	}

	memberSeats := make([]int, 0, len(snapshot.Members))
	for _, member := range snapshot.Members {
		memberSeats = append(memberSeats, member.Seat)
	}
	scoreSeats := make([]int, 0, len(snapshot.Match.Scores))
	for _, score := range snapshot.Match.Scores {
		scoreSeats = append(scoreSeats, score.Seat)
	}
	opponentSeats := make([]int, 0, len(snapshot.Round.Opponents))
	for _, opponent := range snapshot.Round.Opponents {
		opponentSeats = append(opponentSeats, opponent.Seat)
	}
	assertMRX001Fixture(t, "mrx-001-api.json", map[string]any{
		"contract": "openapi",
		"room": map[string]any{
			"status":         snapshot.Status,
			"format":         snapshot.Format,
			"mode":           snapshot.Mode,
			"playerLimit":    snapshot.PlayerLimit,
			"playerCount":    snapshot.PlayerCount,
			"availableSeats": snapshot.AvailableSeats,
		},
		"match": map[string]any{
			"targetWins":  snapshot.Match.TargetWins,
			"scoringMode": snapshot.Match.ScoringMode,
			"rosterSize":  snapshot.Match.RosterSize,
			"maxRounds":   snapshot.Match.MaxRounds,
		},
		"memberSeats": memberSeats,
		"scoreSeats":  scoreSeats,
		"round": map[string]any{
			"status":        snapshot.Round.Status,
			"selfSeat":      *snapshot.Round.Self.Seat,
			"opponentSeats": opponentSeats,
		},
	})

	eventPayloadKeys := func(eventType string) []string {
		t.Helper()
		for _, event := range snapshot.Events {
			if event.Type != eventType {
				continue
			}
			keys := make([]string, 0, len(event.Payload))
			for key := range event.Payload {
				// MRX-003 v3 adds the frozen ruleset identity. The MRX-001 v2
				// fixture remains the semantic baseline for every pre-v3 field.
				if eventType == "match.started" && key == "ruleSetRef" {
					continue
				}
				keys = append(keys, key)
			}
			sort.Strings(keys)
			return keys
		}
		t.Fatalf("snapshot has no %s event", eventType)
		return nil
	}
	assertMRX001Fixture(t, "mrx-001-ws-v2.json", map[string]any{
		"contract": "touhouflandre-multi.v2",
		"events": []map[string]any{
			{"type": "room.updated", "payloadKeys": eventPayloadKeys("room.updated")},
			{"type": "match.started", "payloadKeys": eventPayloadKeys("match.started")},
			{"type": "round.started", "payloadKeys": eventPayloadKeys("round.started")},
		},
	})
	var matchStartedRuleSet map[string]any
	for _, event := range snapshot.Events {
		if event.Type == "match.started" {
			matchStartedRuleSet, _ = event.Payload["ruleSetRef"].(map[string]any)
			break
		}
	}
	if matchStartedRuleSet["mode"] != "race" || matchStartedRuleSet["key"] != string(snapshot.Match.ScoringMode) || matchStartedRuleSet["version"] != float64(1) {
		t.Fatalf("v3 match.started ruleSetRef = %#v", matchStartedRuleSet)
	}

	var migrationTail int
	if err := pool.QueryRow(ctx, `SELECT coalesce(max(version_id), 0)::int FROM goose_db_version WHERE is_applied`).Scan(&migrationTail); err != nil {
		t.Fatal(err)
	}
	if migrationTail != 19 {
		t.Fatalf("migration tail = %d, want MRX-004 migration 19", migrationTail)
	}
	tableNames := []string{"multi_room", "multi_match", "multi_round", "multi_turn", "multi_chat_message"}
	tables := make([]map[string]any, 0, len(tableNames))
	for _, tableName := range tableNames {
		rows, err := pool.Query(ctx, `
			SELECT column_name
			FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = $1
			ORDER BY ordinal_position`, tableName)
		if err != nil {
			t.Fatal(err)
		}
		var columns []string
		for rows.Next() {
			var column string
			if err := rows.Scan(&column); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			if tableName == "multi_match" && (column == "rule_set_key" || column == "rule_set_version" || column == "rule_config_snapshot") {
				continue
			}
			columns = append(columns, column)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		rows.Close()
		tables = append(tables, map[string]any{"name": tableName, "columns": columns})
	}
	assertMRX001Fixture(t, "mrx-001-database.json", map[string]any{
		"migrationTail": 14,
		"tables":        tables,
	})
}

func assertMRX001Fixture(t *testing.T, name string, actual any) {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve MRX-001 fixture path")
	}
	repoRoot := filepath.Join(filepath.Dir(filename), "..", "..", "..", "..")
	fixturePath := filepath.Join(repoRoot, "docs", "multiplayer-relay-expansion", "fixtures", name)
	wantBytes, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	var want any
	if err := json.Unmarshal(wantBytes, &want); err != nil {
		t.Fatalf("decode %s: %v", fixturePath, err)
	}
	actualBytes, err := json.Marshal(actual)
	if err != nil {
		t.Fatal(err)
	}
	var normalizedActual any
	if err := json.Unmarshal(actualBytes, &normalizedActual); err != nil {
		t.Fatal(err)
	}
	wantCanonical, _ := json.MarshalIndent(want, "", "  ")
	actualCanonical, _ := json.MarshalIndent(normalizedActual, "", "  ")
	if string(actualCanonical) != string(wantCanonical) {
		t.Fatalf("%s drifted\nwant:\n%s\nactual:\n%s", name, wantCanonical, actualCanonical)
	}
}
