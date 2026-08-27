package migrations_test

import (
	"testing"

	"github.com/pressly/goose/v3"
)

func TestDynamicFeedbackStatusConstraintsAcceptRegistryWidths(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.Up(db, migrationsDir); err != nil {
		t.Fatal(err)
	}
	insertMRX003RelayRoster(t, db)
	if _, err := db.Exec(`
		INSERT INTO multi_round
			(id, match_id, round_index, answer_id, status, starts_at, deadline)
		VALUES ('dynamic-round', 'relay-match', 1, 'answer', 'playing', now(), now() + interval '5 minutes')`); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Exec(`
		INSERT INTO multi_guess
			(id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key)
		VALUES ('guess-5', 'dynamic-round', 'member-1', 1, 'guess-5',
			'["exact","partial","miss","higher","lower"]'::jsonb, false, 'guess-5')`); err != nil {
		t.Fatalf("insert five-field race guess: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_turn
			(id, round_id, member_id, turn_index, kind, guess_id, statuses, is_correct, idempotency_key)
		VALUES ('turn-7', 'dynamic-round', 'member-2', 1, 'guess', 'guess-7',
			'["exact","partial","miss","higher","lower","unknown","miss"]'::jsonb, false, 'turn-7')`); err != nil {
		t.Fatalf("insert seven-field legacy relay turn: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage
			(id, match_id, stage_index, status, planned_encounter_count, starts_at)
		VALUES ('stage-1', 'relay-match', 1, 'playing', 1, now())`); err != nil {
		t.Fatal(err)
	}
	insertMRX003Encounter(t, db, "encounter-1", 1, "member-1", "member-2")
	if _, err := db.Exec(`
		INSERT INTO multi_relay_turn (
			id, match_id, stage_id, encounter_id, member_id, turn_index,
			kind, guess_id, statuses, is_correct, idempotency_key
		) VALUES (
			'relay-turn-5', 'relay-match', 'stage-1', 'encounter-1', 'member-1', 1,
			'guess', 'relay-guess-5', '["exact","partial","miss","higher","lower"]'::jsonb,
			false, 'relay-turn-5'
		)`); err != nil {
		t.Fatalf("insert five-field encounter turn: %v", err)
	}

	_, err := db.Exec(`
		INSERT INTO multi_guess
			(id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key)
		VALUES ('guess-invalid', 'dynamic-round', 'member-1', 2, 'guess-invalid',
			'["exact","invalid"]'::jsonb, false, 'guess-invalid')`)
	assertPostgresCode(t, err, "23514")
	_, err = db.Exec(`
		INSERT INTO multi_guess
			(id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key)
		VALUES ('guess-empty', 'dynamic-round', 'member-1', 2, 'guess-empty',
			'[]'::jsonb, false, 'guess-empty')`)
	assertPostgresCode(t, err, "23514")
}
