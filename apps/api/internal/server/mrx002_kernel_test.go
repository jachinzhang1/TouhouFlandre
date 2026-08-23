package server_test

import (
	"net/http"
	"testing"
)

func TestMRX003UnknownPersistedRuleSetVersionFailsClosed(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo3", "relay", 60)
	snapshot := startMatch(t, fixture)
	if snapshot.Match == nil || snapshot.Round == nil {
		t.Fatal("expected active relay match and round")
	}

	if _, err := pool.Exec(ctx, `UPDATE multi_match SET rule_set_version = 2 WHERE room_id = $1`, fixture.roomID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(ctx, `UPDATE multi_match SET rule_set_version = 1 WHERE room_id = $1`, fixture.roomID); err != nil {
			t.Errorf("restore rule-set version: %v", err)
		}
	})
	var eventsBefore, turnsBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM room_event WHERE room_id = $1`, fixture.roomID).Scan(&eventsBefore); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM multi_turn t JOIN multi_round r ON r.id = t.round_id JOIN multi_match m ON m.id = r.match_id WHERE m.room_id = $1`, fixture.roomID).Scan(&turnsBefore); err != nil {
		t.Fatal(err)
	}

	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/snapshot", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("snapshot status = %d, want 500: %s", resp.StatusCode, payload)
	}
	if got := decodeError(t, payload).Code; got != "INTERNAL" {
		t.Fatalf("snapshot code = %s, want INTERNAL", got)
	}

	answer := currentAnswer(t, fixture.roomID)
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "mrx002-invalid-ruleset")
	if resp.StatusCode != http.StatusInternalServerError {
		t.Fatalf("guess status = %d, want 500: %s", resp.StatusCode, payload)
	}
	if got := decodeError(t, payload).Code; got != "INTERNAL" {
		t.Fatalf("guess code = %s, want INTERNAL", got)
	}

	var eventsAfter, turnsAfter int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM room_event WHERE room_id = $1`, fixture.roomID).Scan(&eventsAfter); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM multi_turn t JOIN multi_round r ON r.id = t.round_id JOIN multi_match m ON m.id = r.match_id WHERE m.room_id = $1`, fixture.roomID).Scan(&turnsAfter); err != nil {
		t.Fatal(err)
	}
	if eventsAfter != eventsBefore || turnsAfter != turnsBefore {
		t.Fatalf("failed commands wrote state: events %d->%d, turns %d->%d", eventsBefore, eventsAfter, turnsBefore, turnsAfter)
	}
}
