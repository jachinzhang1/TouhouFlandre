package migrations_test

import (
	"testing"

	"github.com/pressly/goose/v3"
)

func TestMRX006EncounterAuthorityIsExpandOnlyAndReapplicable(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 16); err != nil {
		t.Fatal(err)
	}
	insertMRX003RelayRoster(t, db)
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage
			(id, match_id, stage_index, status, planned_encounter_count, starts_at)
		VALUES ('mrx006-stage', 'relay-match', 1, 'playing', 1, now())`); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.Exec(`
		INSERT INTO multi_relay_encounter (
			id, match_id, stage_id, encounter_index, status, answer_id,
			starts_at, deadline, turn_member_id, turn_deadline
		) VALUES (
			'mrx006-encounter', 'relay-match', 'mrx006-stage', 1, 'playing', 'answer',
			now(), now() + interval '5 minutes', 'member-1', now() + interval '30 seconds'
		)`); err != nil {
		t.Fatal(err)
	}
	for side, memberID := range []string{"member-1", "member-2"} {
		if _, err := tx.Exec(`
			INSERT INTO multi_relay_encounter_member
				(match_id, stage_id, encounter_id, member_id, side, seat)
			VALUES ('relay-match', 'mrx006-stage', 'mrx006-encounter', $1, $2, $2)`, memberID, side+1); err != nil {
			t.Fatal(err)
		}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	if err := goose.UpTo(db, migrationsDir, 17); err != nil {
		t.Fatal(err)
	}
	assertMigrationColumn(t, db, "multi_relay_encounter", "ended_by_member_id", true)
	assertMigrationColumn(t, db, "multi_relay_encounter", "end_idempotency_key", true)

	_, err = db.Exec(`
		UPDATE multi_relay_encounter
		SET turn_member_id = 'member-3'
		WHERE id = 'mrx006-encounter'`)
	assertPostgresCode(t, err, "23503")
	_, err = db.Exec(`
		UPDATE multi_relay_encounter
		SET status = 'ended', turn_member_id = NULL, turn_deadline = NULL,
		    winner_member_id = 'member-2', outcome = 'forfeit', ended_at = now()
		WHERE id = 'mrx006-encounter'`)
	assertPostgresCode(t, err, "23514")
	if _, err := db.Exec(`
		UPDATE multi_relay_encounter
		SET status = 'ended', turn_member_id = NULL, turn_deadline = NULL,
		    winner_member_id = 'member-2', outcome = 'forfeit', ended_at = now(),
		    ended_by_member_id = 'member-1', end_idempotency_key = 'mrx006-forfeit'
		WHERE id = 'mrx006-encounter'`); err != nil {
		t.Fatal(err)
	}

	if err := goose.DownTo(db, migrationsDir, 16); err != nil {
		t.Fatal(err)
	}
	assertMigrationColumn(t, db, "multi_relay_encounter", "ended_by_member_id", true)
	if err := goose.UpTo(db, migrationsDir, 17); err != nil {
		t.Fatalf("reapply expand-only migration: %v", err)
	}
	var status, key string
	if err := db.QueryRow(`
		SELECT status, end_idempotency_key
		FROM multi_relay_encounter
		WHERE id = 'mrx006-encounter'`).Scan(&status, &key); err != nil {
		t.Fatal(err)
	}
	if status != "ended" || key != "mrx006-forfeit" {
		t.Fatalf("terminal history changed on reapply: status=%s key=%s", status, key)
	}
}
