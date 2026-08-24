package migrations_test

import (
	"testing"

	"github.com/pressly/goose/v3"
)

func TestMRX005RelayStageByeIsExpandOnlyAndRosterBound(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 15); err != nil {
		t.Fatal(err)
	}
	insertMRX003RelayRoster(t, db)
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage
			(id, match_id, stage_index, status, planned_encounter_count, starts_at)
		VALUES ('mrx005-stage', 'relay-match', 1, 'planned', 1, now())`); err != nil {
		t.Fatal(err)
	}
	assertMigrationTable(t, db, "multi_relay_stage_bye", false)

	if err := goose.UpTo(db, migrationsDir, 16); err != nil {
		t.Fatal(err)
	}
	assertMigrationTable(t, db, "multi_relay_stage_bye", true)
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage_bye (stage_id, match_id, member_id, seat)
		VALUES ('mrx005-stage', 'relay-match', 'member-3', 3)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_relay_stage_bye (stage_id, match_id, member_id, seat)
		VALUES ('mrx005-stage', 'relay-match', 'member-4', 4)`); err == nil {
		t.Fatal("stage accepted a second bye")
	}
	if _, err := db.Exec(`
		UPDATE multi_relay_stage_bye
		SET member_id = 'not-in-roster'
		WHERE stage_id = 'mrx005-stage'`); err == nil {
		t.Fatal("bye accepted a member outside the frozen roster")
	}

	if err := goose.DownTo(db, migrationsDir, 15); err != nil {
		t.Fatal(err)
	}
	assertMigrationTable(t, db, "multi_relay_stage_bye", true)
	if err := goose.UpTo(db, migrationsDir, 16); err != nil {
		t.Fatal(err)
	}
	var memberID string
	if err := db.QueryRow(`SELECT member_id FROM multi_relay_stage_bye WHERE stage_id = 'mrx005-stage'`).Scan(&memberID); err != nil {
		t.Fatal(err)
	}
	if memberID != "member-3" {
		t.Fatalf("reapplied migration changed bye to %s", memberID)
	}
}
