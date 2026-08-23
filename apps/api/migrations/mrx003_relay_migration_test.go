package migrations_test

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

func TestMRX003RuleSetBackfillAndExpandOnlyReapply(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 14); err != nil {
		t.Fatalf("migrate to pre-MRX-003 schema: %v", err)
	}
	insertMRX003Catalog(t, db)

	want := map[string]string{
		"race-wins-match":      "wins",
		"race-points-match":    "points",
		"race-placement-match": "placement",
		"relay-legacy-match":   "legacy_wins",
	}
	fixtures := []struct {
		matchID, roomID, code, mode, scoring string
	}{
		{"race-wins-match", "race-wins-room", "RWINS1", "race", "wins"},
		{"race-points-match", "race-points-room", "RPOINT", "race", "points"},
		{"race-placement-match", "race-placement-room", "RPLACE", "race", "placement"},
		{"relay-legacy-match", "relay-legacy-room", "RLEGAC", "relay", "wins"},
	}
	for _, fixture := range fixtures {
		insertMRX003LegacyMatch(t, db, fixture.matchID, fixture.roomID, fixture.code, fixture.mode, fixture.scoring)
	}

	if err := goose.UpTo(db, migrationsDir, 15); err != nil {
		t.Fatalf("apply MRX-003 migration: %v", err)
	}
	assertMRX003Backfill(t, db, want)
	assertMigrationColumn(t, db, "multi_match", "scoring_mode", true)
	assertMigrationColumn(t, db, "multi_round", "answer_id", true)
	assertMigrationColumn(t, db, "multi_turn", "round_id", true)
	for _, table := range []string{
		"multi_relay_stage",
		"multi_relay_encounter",
		"multi_relay_encounter_member",
		"multi_relay_turn",
		"multi_relay_match_player_state",
		"multi_relay_stage_player",
	} {
		assertMigrationTable(t, db, table, true)
	}

	var snapshotsBefore string
	if err := db.QueryRow(`
		SELECT jsonb_agg(rule_config_snapshot ORDER BY id)::text
		FROM multi_match`).Scan(&snapshotsBefore); err != nil {
		t.Fatal(err)
	}
	if err := goose.DownTo(db, migrationsDir, 14); err != nil {
		t.Fatalf("move application migration version back: %v", err)
	}
	assertMigrationTable(t, db, "multi_relay_stage", true)
	assertMigrationColumn(t, db, "multi_match", "rule_set_key", true)
	if err := goose.UpTo(db, migrationsDir, 15); err != nil {
		t.Fatalf("reapply MRX-003 migration: %v", err)
	}
	assertMRX003Backfill(t, db, want)
	var snapshotsAfter string
	if err := db.QueryRow(`
		SELECT jsonb_agg(rule_config_snapshot ORDER BY id)::text
		FROM multi_match`).Scan(&snapshotsAfter); err != nil {
		t.Fatal(err)
	}
	if snapshotsAfter != snapshotsBefore {
		t.Fatalf("reapply changed frozen snapshots: before=%s after=%s", snapshotsBefore, snapshotsAfter)
	}
}

func TestMRX003RuleSetBackfillRejectsContradictoryAndUnknownLegacyData(t *testing.T) {
	tests := []struct {
		name             string
		mode             string
		scoring          string
		dropScoringCheck bool
		dropModeCheck    bool
	}{
		{name: "relay points is contradictory", mode: "relay", scoring: "points"},
		{name: "unknown race scoring", mode: "race", scoring: "mystery", dropScoringCheck: true},
		{name: "unknown room mode", mode: "mystery", scoring: "wins", dropModeCheck: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			db, migrationsDir := newMigrationTestDatabase(t)
			if err := goose.UpTo(db, migrationsDir, 14); err != nil {
				t.Fatal(err)
			}
			insertMRX003Catalog(t, db)
			if test.dropScoringCheck {
				if _, err := db.Exec(`ALTER TABLE multi_match DROP CONSTRAINT multi_match_scoring_mode_check`); err != nil {
					t.Fatal(err)
				}
			}
			if test.dropModeCheck {
				if _, err := db.Exec(`ALTER TABLE multi_room DROP CONSTRAINT multi_room_mode_check`); err != nil {
					t.Fatal(err)
				}
			}
			insertMRX003LegacyMatch(t, db, "invalid-match", "invalid-room", "INVAL1", test.mode, test.scoring)
			err := goose.UpTo(db, migrationsDir, 15)
			if err == nil || !strings.Contains(err.Error(), "MRX-003 rule-set backfill refused") {
				t.Fatalf("migration error = %v, want explicit backfill refusal", err)
			}
			assertMigrationColumn(t, db, "multi_match", "rule_set_key", false)
		})
	}
}

func TestMRX003ExpandMigrationAcceptsLegacyBinaryMatchInsert(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.Up(db, migrationsDir); err != nil {
		t.Fatal(err)
	}
	insertMRX003Catalog(t, db)
	insertMRX003LegacyMatch(t, db, "rollback-match", "rollback-room", "ROLLBK", "relay", "wins")

	assertMRX003Backfill(t, db, map[string]string{"rollback-match": "legacy_wins"})
	var mode string
	if err := db.QueryRow(`
		SELECT rule_config_snapshot ->> 'mode'
		FROM multi_match
		WHERE id = 'rollback-match'`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "relay" {
		t.Fatalf("legacy insert snapshot mode = %q, want relay", mode)
	}
}

func TestMRX003RelayStorageConstraints(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.Up(db, migrationsDir); err != nil {
		t.Fatal(err)
	}
	insertMRX003RelayRoster(t, db)
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage
			(id, match_id, stage_index, status, planned_encounter_count, starts_at)
		VALUES ('stage-1', 'relay-match', 1, 'playing', 2, now())`); err != nil {
		t.Fatal(err)
	}

	assertMRX003EncounterMemberCount(t, db, 0)
	assertMRX003EncounterMemberCount(t, db, 1)
	insertMRX003Encounter(t, db, "encounter-1", 1, "member-1", "member-2")
	insertMRX003Encounter(t, db, "encounter-2", 2, "member-3", "member-4")

	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(`
		INSERT INTO multi_relay_encounter (
			id, match_id, stage_id, encounter_index, status, answer_id, starts_at, deadline
		) VALUES ('encounter-3', 'relay-match', 'stage-1', 3, 'planned', 'answer', now(), now() + interval '5 minutes')`); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(`
		INSERT INTO multi_relay_encounter_member
			(match_id, stage_id, encounter_id, member_id, side, seat)
		VALUES ('relay-match', 'stage-1', 'encounter-3', 'member-1', 1, 1)`)
	assertPostgresCode(t, err, "23505")
	_ = tx.Rollback()

	statuses := `["exact","partial","miss","higher","lower","unknown"]`
	insertTurn := func(id, encounterID, memberID, guessID, idempotencyKey string) error {
		_, err := db.Exec(`
			INSERT INTO multi_relay_turn (
				id, match_id, stage_id, encounter_id, member_id, turn_index,
				kind, guess_id, statuses, is_correct, idempotency_key
			) VALUES ($1, 'relay-match', 'stage-1', $2, $3,
				(SELECT coalesce(max(turn_index), 0) + 1 FROM multi_relay_turn WHERE encounter_id = $2),
				'guess', $4, $5::jsonb, false, $6)`,
			id, encounterID, memberID, guessID, statuses, idempotencyKey)
		return err
	}
	if err := insertTurn("turn-1", "encounter-1", "member-1", "same-guess", "idem-1"); err != nil {
		t.Fatalf("first encounter guess: %v", err)
	}
	if err := insertTurn("turn-2", "encounter-2", "member-3", "same-guess", "idem-1"); err != nil {
		t.Fatalf("same guess in another encounter: %v", err)
	}
	assertPostgresCode(t, insertTurn("turn-3", "encounter-1", "member-2", "same-guess", "idem-2"), "23505")
	assertPostgresCode(t, insertTurn("turn-4", "encounter-1", "member-1", "other-guess", "idem-1"), "23505")
	if _, err := db.Exec(`
		UPDATE multi_relay_encounter
		SET status = 'ended', outcome = 'forfeit', winner_member_id = 'member-2', ended_at = now()
		WHERE id = 'encounter-1'`); err != nil {
		t.Fatalf("persist forfeit encounter outcome: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO multi_relay_match_player_state
			(match_id, member_id, score, life_state)
		VALUES ('relay-match', 'member-1', -3, 'near_death')`); err != nil {
		t.Fatal(err)
	}
	var score int
	var status, lifeState string
	if err := db.QueryRow(`
		SELECT state.score, player.status, state.life_state
		FROM multi_relay_match_player_state AS state
		JOIN multi_match_player AS player USING (match_id, member_id)
		WHERE state.match_id = 'relay-match' AND state.member_id = 'member-1'`).Scan(&score, &status, &lifeState); err != nil {
		t.Fatal(err)
	}
	if score != -3 || status != "active" || lifeState != "near_death" {
		t.Fatalf("relay state round-trip = score:%d status:%s life:%s", score, status, lifeState)
	}
	_, err = db.Exec(`UPDATE multi_match_player SET score = -1 WHERE match_id = 'relay-match' AND member_id = 'member-1'`)
	assertPostgresCode(t, err, "23514")
	if _, err := db.Exec(`DELETE FROM multi_relay_stage WHERE id = 'stage-1'`); err != nil {
		t.Fatalf("stage cascade delete: %v", err)
	}
}

func insertMRX003Catalog(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO catalog_snapshot (version, characters)
		VALUES ('mrx003-catalog', '[]'::jsonb)`); err != nil {
		t.Fatal(err)
	}
}

func insertMRX003LegacyMatch(t *testing.T, db *sql.DB, matchID, roomID, code, mode, scoring string) {
	t.Helper()
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, mode, player_limit, expires_at)
		VALUES ($1, $2, 'bo3', 'finished', $3, 2, now() + interval '1 hour')`, roomID, code, mode); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_match (
			id, room_id, match_index, catalog_version, target_wins, status,
			started_at, scoring_mode, roster_size, max_rounds
		) VALUES ($1, $2, 0, 'mrx003-catalog', 2, 'finished', now(), $3, 2, 9)`,
		matchID, roomID, scoring); err != nil {
		t.Fatal(err)
	}
}

func assertMRX003Backfill(t *testing.T, db *sql.DB, want map[string]string) {
	t.Helper()
	rows, err := db.Query(`
		SELECT id, rule_set_key, rule_set_version, jsonb_typeof(rule_config_snapshot)
		FROM multi_match ORDER BY id`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := 0
	for rows.Next() {
		var id, key, snapshotType string
		var version int
		if err := rows.Scan(&id, &key, &version, &snapshotType); err != nil {
			t.Fatal(err)
		}
		if key != want[id] || version != 1 || snapshotType != "object" {
			t.Errorf("backfill %s = %s@%d snapshot:%s, want %s@1 object", id, key, version, snapshotType, want[id])
		}
		seen++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if seen != len(want) {
		t.Fatalf("backfill rows = %d, want %d", seen, len(want))
	}
}

func insertMRX003RelayRoster(t *testing.T, db *sql.DB) {
	t.Helper()
	insertMRX003Catalog(t, db)
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, mode, player_limit, expires_at)
		VALUES ('relay-room', 'RELAY1', 'bo3', 'playing', 'relay', 2, now() + interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	for seat := 1; seat <= 4; seat++ {
		memberID := fmt.Sprintf("member-%d", seat)
		if _, err := db.Exec(`
			INSERT INTO multi_member (id, room_id, seat, role, display_name, token_hash)
			VALUES ($1, 'relay-room', $2, 'player', $1, $3)`, memberID, seat, "token-"+memberID); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO multi_match (
			id, room_id, match_index, catalog_version, target_wins, status,
			started_at, scoring_mode, roster_size, max_rounds,
			rule_set_key, rule_set_version, rule_config_snapshot
		) VALUES (
			'relay-match', 'relay-room', 0, 'mrx003-catalog', 2, 'playing',
			now(), 'wins', 4, 9, 'fixed_points', 1, '{}'::jsonb
		)`); err != nil {
		t.Fatal(err)
	}
	for seat := 1; seat <= 4; seat++ {
		memberID := fmt.Sprintf("member-%d", seat)
		if _, err := db.Exec(`
			INSERT INTO multi_match_player (match_id, member_id, seat)
			VALUES ('relay-match', $1, $2)`, memberID, seat); err != nil {
			t.Fatal(err)
		}
	}
}

func assertMRX003EncounterMemberCount(t *testing.T, db *sql.DB, count int) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	encounterID := "invalid-encounter-" + string(rune('0'+count))
	if _, err := tx.Exec(`
		INSERT INTO multi_relay_encounter (
			id, match_id, stage_id, encounter_index, status, answer_id, starts_at, deadline
		) VALUES ($1, 'relay-match', 'stage-1', 4, 'planned', 'answer', now(), now() + interval '5 minutes')`, encounterID); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if count == 1 {
		if _, err := tx.Exec(`
			INSERT INTO multi_relay_encounter_member
				(match_id, stage_id, encounter_id, member_id, side, seat)
			VALUES ('relay-match', 'stage-1', $1, 'member-1', 1, 1)`, encounterID); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	err = tx.Commit()
	var pgErr *pgconn.PgError
	if err == nil || !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("commit encounter with %d members error = %v, want 23514", count, err)
	}
}

func insertMRX003Encounter(t *testing.T, db *sql.DB, encounterID string, index int, firstMember, secondMember string) {
	t.Helper()
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`
		INSERT INTO multi_relay_encounter (
			id, match_id, stage_id, encounter_index, status, answer_id, starts_at, deadline
		) VALUES ($1, 'relay-match', 'stage-1', $2, 'playing', 'answer', now(), now() + interval '5 minutes')`, encounterID, index); err != nil {
		t.Fatal(err)
	}
	for side, memberID := range []string{firstMember, secondMember} {
		seat := side + 1
		if memberID == "member-3" || memberID == "member-4" {
			seat += 2
		}
		if _, err := tx.Exec(`
			INSERT INTO multi_relay_encounter_member
				(match_id, stage_id, encounter_id, member_id, side, seat)
			VALUES ('relay-match', 'stage-1', $1, $2, $3, $4)`, encounterID, memberID, side+1, seat); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}
