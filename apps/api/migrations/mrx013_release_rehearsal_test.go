package migrations_test

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
)

func TestMRX013Migration0014To0019RollbackAndReapply(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 14); err != nil {
		t.Fatalf("migrate disposable database to 0014: %v", err)
	}
	insertMRX003Catalog(t, db)

	legacyMatches := []struct {
		id      string
		roomID  string
		code    string
		mode    string
		scoring string
	}{
		{id: "mrx013-race-wins", roomID: "mrx013-race-wins-room", code: "M13RW1", mode: "race", scoring: "wins"},
		{id: "mrx013-race-points", roomID: "mrx013-race-points-room", code: "M13RP1", mode: "race", scoring: "points"},
		{id: "mrx013-race-placement", roomID: "mrx013-race-placement-room", code: "M13RL1", mode: "race", scoring: "placement"},
		{id: "mrx013-relay-legacy", roomID: "mrx013-relay-legacy-room", code: "M13RR1", mode: "relay", scoring: "wins"},
	}
	for _, fixture := range legacyMatches {
		insertMRX003LegacyMatch(t, db, fixture.id, fixture.roomID, fixture.code, fixture.mode, fixture.scoring)
		insertMRX013LegacyRoster(t, db, fixture.id, fixture.roomID)
	}
	insertMRX013FinishedHistoryAndChat(t, db, "mrx013-relay-legacy", "mrx013-relay-legacy-room")

	before := readMRX013MigrationSummary(t, db)
	startedAt := time.Now()
	if err := goose.UpTo(db, migrationsDir, 19); err != nil {
		t.Fatalf("migrate disposable database from 0014 to 0019: %v", err)
	}
	t.Logf("0014 -> 0019 duration: %s", time.Since(startedAt))
	assertMRX003Backfill(t, db, map[string]string{
		"mrx013-race-wins":      "wins",
		"mrx013-race-points":    "points",
		"mrx013-race-placement": "placement",
		"mrx013-relay-legacy":   "legacy_wins",
	})
	after := readMRX013MigrationSummary(t, db)
	if after.rooms != before.rooms || after.matches != before.matches || after.rounds != before.rounds || after.turns != before.turns || after.chatMessages != before.chatMessages {
		t.Fatalf("0014 -> 0019 changed legacy row summary: before=%+v after=%+v", before, after)
	}
	if after.relayRoomConfigs != 1 {
		t.Fatalf("relay room config rows = %d, want 1 backfilled row", after.relayRoomConfigs)
	}

	insertMRX013V3Fixture(t, db)
	if err := goose.DownTo(db, migrationsDir, 14); err != nil {
		t.Fatalf("move application migration version back to 0014: %v", err)
	}
	assertMigrationTable(t, db, "multi_relay_stage", true)
	assertMigrationTable(t, db, "multi_relay_room_config", true)
	assertMigrationColumn(t, db, "multi_match", "rule_set_key", true)
	assertMRX013V3Fixture(t, db)

	// Simulate a previous binary: it names only the columns known at 0014.
	insertMRX003LegacyMatch(t, db, "mrx013-old-binary-match", "mrx013-old-binary-room", "M13OLD", "relay", "wins")
	assertMRX003Backfill(t, db, map[string]string{
		"mrx013-old-binary-match": "legacy_wins",
		"mrx013-race-wins":        "wins",
		"mrx013-race-points":      "points",
		"mrx013-race-placement":   "placement",
		"mrx013-relay-legacy":     "legacy_wins",
		"mrx013-v3-match":         "fixed_points",
	})
	var configRows int
	if err := db.QueryRow(`SELECT count(*) FROM multi_relay_room_config WHERE room_id = 'mrx013-old-binary-room'`).Scan(&configRows); err != nil {
		t.Fatal(err)
	}
	if configRows != 1 {
		t.Fatalf("old-binary relay insert created %d config rows, want 1", configRows)
	}

	beforeReapply := readMRX013MigrationSummary(t, db)
	startedAt = time.Now()
	if err := goose.UpTo(db, migrationsDir, 19); err != nil {
		t.Fatalf("reapply 0015 through 0019: %v", err)
	}
	t.Logf("0015 -> 0019 reapply duration: %s", time.Since(startedAt))
	afterReapply := readMRX013MigrationSummary(t, db)
	if afterReapply != beforeReapply {
		t.Fatalf("migration reapply changed row summary: before=%+v after=%+v", beforeReapply, afterReapply)
	}
	assertMRX013V3Fixture(t, db)
}

func TestMRX013Migrations0015Through0019DeclareExpandOnlyDown(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve migration test path")
	}
	migrationsDir := filepath.Dir(filename)
	for version := 15; version <= 19; version++ {
		matches, err := filepath.Glob(filepath.Join(migrationsDir, fmt.Sprintf("%04d_*.sql", version)))
		if err != nil || len(matches) != 1 {
			t.Fatalf("resolve migration %04d: matches=%v err=%v", version, matches, err)
		}
		contents, err := os.ReadFile(matches[0])
		if err != nil {
			t.Fatal(err)
		}
		_, down, found := strings.Cut(string(contents), "-- +goose Down")
		if !found {
			t.Fatalf("migration %04d has no Down declaration", version)
		}
		var statements []string
		for _, line := range strings.Split(down, "\n") {
			line = strings.TrimSpace(line)
			if line != "" && !strings.HasPrefix(line, "--") {
				statements = append(statements, strings.ToLower(line))
			}
		}
		declared := strings.Join(statements, " ")
		if declared != "select 1;" {
			t.Fatalf("migration %04d Down is not expand-only no-op: %q", version, declared)
		}
	}
}

type mrx013MigrationSummary struct {
	rooms            int
	matches          int
	rounds           int
	turns            int
	chatMessages     int
	relayRoomConfigs int
	relayStages      int
}

func readMRX013MigrationSummary(t *testing.T, db *sql.DB) mrx013MigrationSummary {
	t.Helper()
	var summary mrx013MigrationSummary
	queries := []struct {
		query string
		value *int
	}{
		{query: `SELECT count(*) FROM multi_room`, value: &summary.rooms},
		{query: `SELECT count(*) FROM multi_match`, value: &summary.matches},
		{query: `SELECT count(*) FROM multi_round`, value: &summary.rounds},
		{query: `SELECT count(*) FROM multi_turn`, value: &summary.turns},
		{query: `SELECT count(*) FROM multi_chat_message`, value: &summary.chatMessages},
	}
	for _, item := range queries {
		if err := db.QueryRow(item.query).Scan(item.value); err != nil {
			t.Fatal(err)
		}
	}
	if tableExists(t, db, "multi_relay_room_config") {
		if err := db.QueryRow(`SELECT count(*) FROM multi_relay_room_config`).Scan(&summary.relayRoomConfigs); err != nil {
			t.Fatal(err)
		}
	}
	if tableExists(t, db, "multi_relay_stage") {
		if err := db.QueryRow(`SELECT count(*) FROM multi_relay_stage`).Scan(&summary.relayStages); err != nil {
			t.Fatal(err)
		}
	}
	return summary
}

func tableExists(t *testing.T, db *sql.DB, table string) bool {
	t.Helper()
	var exists bool
	if err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)`, table).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}

func insertMRX013LegacyRoster(t *testing.T, db *sql.DB, matchID, roomID string) {
	t.Helper()
	for seat := 1; seat <= 2; seat++ {
		memberID := fmt.Sprintf("%s-member-%d", matchID, seat)
		if _, err := db.Exec(`
			INSERT INTO multi_member (id, room_id, seat, role, display_name, token_hash)
			VALUES ($1, $2, $3, 'player', $1, $1 || '-token')`, memberID, roomID, seat); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(`
			INSERT INTO multi_match_player (match_id, member_id, seat)
			VALUES ($1, $2, $3)`, matchID, memberID, seat); err != nil {
			t.Fatal(err)
		}
	}
}

func insertMRX013FinishedHistoryAndChat(t *testing.T, db *sql.DB, matchID, roomID string) {
	t.Helper()
	memberID := matchID + "-member-1"
	if _, err := db.Exec(`
		INSERT INTO multi_round (
			id, match_id, round_index, answer_id, status, winner_slot,
			winner_member_id, starts_at, deadline, ended_at
		) VALUES (
			'mrx013-legacy-round', $1, 1, 'legacy-answer', 'ended', 1,
			$2, now() - interval '2 minutes', now() - interval '1 minute', now() - interval '1 minute'
		)`, matchID, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_turn (
			id, round_id, member_id, turn_index, kind, guess_id, statuses, is_correct, idempotency_key
		) VALUES (
			'mrx013-legacy-turn', 'mrx013-legacy-round', $1, 1, 'guess', 'legacy-answer',
			'["exact","exact","exact","exact","exact","exact"]'::jsonb, true, 'mrx013-legacy-idem'
		)`, memberID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE multi_room SET chat_seq = 1 WHERE id = $1`, roomID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_chat_message (
			id, room_id, position, sender_member_id, sender_display_name, sender_role,
			sender_seat, client_message_id, kind, content, channel
		) VALUES (
			'mrx013-legacy-chat', $1, 1, $2, 'legacy-player', 'player',
			1, '00000000-0000-0000-0000-000000000013', 'text', 'legacy chat', 'room'
		)`, roomID, memberID); err != nil {
		t.Fatal(err)
	}
}

func insertMRX013V3Fixture(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, mode, player_limit, expires_at)
		VALUES ('mrx013-v3-room', 'M13V30', 'bo3', 'playing', 'relay', 4, now() + interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_match (
			id, room_id, match_index, catalog_version, target_wins, status,
			started_at, scoring_mode, roster_size, max_rounds,
			rule_set_key, rule_set_version, rule_config_snapshot
		) VALUES (
			'mrx013-v3-match', 'mrx013-v3-room', 0, 'mrx003-catalog', 2, 'playing',
			now(), 'wins', 4, 3, 'fixed_points', 1, '{"mode":"relay","stageCount":3}'::jsonb
		)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage (
			id, match_id, stage_index, status, planned_encounter_count, starts_at
		) VALUES ('mrx013-v3-stage', 'mrx013-v3-match', 1, 'planned', 2, now())`); err != nil {
		t.Fatal(err)
	}
}

func assertMRX013V3Fixture(t *testing.T, db *sql.DB) {
	t.Helper()
	var key, stageStatus string
	if err := db.QueryRow(`SELECT rule_set_key FROM multi_match WHERE id = 'mrx013-v3-match'`).Scan(&key); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT status FROM multi_relay_stage WHERE id = 'mrx013-v3-stage'`).Scan(&stageStatus); err != nil {
		t.Fatal(err)
	}
	if key != "fixed_points" || stageStatus != "planned" {
		t.Fatalf("v3 fixture changed: rule=%s stage=%s", key, stageStatus)
	}
}
