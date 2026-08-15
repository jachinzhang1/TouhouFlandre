package migrations_test

import (
	"database/sql"
	"testing"

	"github.com/pressly/goose/v3"
)

func TestNPlayerRosterMigrationBackfillsLegacyScoresAndWinners(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 9); err != nil {
		t.Fatalf("migrate to legacy score schema: %v", err)
	}
	insertLegacyRosterFixture(t, db)

	if err := goose.UpTo(db, migrationsDir, 10); err != nil {
		t.Fatalf("migrate roster expand schema: %v", err)
	}

	type rosterScore struct {
		memberID string
		seat     int
		wins     int
		status   string
	}
	rows, err := db.Query(`
		SELECT member_id, seat, wins, status
		FROM multi_match_player
		WHERE match_id = 'legacy-match'
		ORDER BY seat`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []rosterScore
	for rows.Next() {
		var score rosterScore
		if err := rows.Scan(&score.memberID, &score.seat, &score.wins, &score.status); err != nil {
			t.Fatal(err)
		}
		got = append(got, score)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []rosterScore{
		{memberID: "legacy-host", seat: 1, wins: 2, status: "active"},
		{memberID: "legacy-guest", seat: 2, wins: 1, status: "active"},
	}
	if len(got) != len(want) {
		t.Fatalf("migrated roster = %+v, want %+v", got, want)
	}
	for index := range want {
		if got[index] != want[index] {
			t.Errorf("migrated roster[%d] = %+v, want %+v", index, got[index], want[index])
		}
	}

	var roundPlayerCount int
	if err := db.QueryRow(`SELECT count(*) FROM multi_round_player WHERE round_id IN ('legacy-round-1', 'legacy-round-2')`).Scan(&roundPlayerCount); err != nil {
		t.Fatal(err)
	}
	if roundPlayerCount != 4 {
		t.Fatalf("migrated round players = %d, want 4", roundPlayerCount)
	}

	for _, round := range []struct {
		id     string
		winner string
	}{
		{id: "legacy-round-1", winner: "legacy-host"},
		{id: "legacy-round-2", winner: "legacy-guest"},
	} {
		var winner sql.NullString
		if err := db.QueryRow(`SELECT winner_member_id FROM multi_round WHERE id = $1`, round.id).Scan(&winner); err != nil {
			t.Fatal(err)
		}
		if !winner.Valid || winner.String != round.winner {
			t.Errorf("round %s winner_member_id = %+v, want %s", round.id, winner, round.winner)
		}
	}

	// Expand migration intentionally preserves legacy columns during rollout.
	assertMigrationColumn(t, db, "multi_match", "score_slot1", true)
	assertMigrationColumn(t, db, "multi_match", "score_slot2", true)
	assertMigrationColumn(t, db, "multi_round", "winner_slot", true)
}

func TestNPlayerRosterMigrationDownKeepsExpandSchemaAndReapplies(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 9); err != nil {
		t.Fatalf("migrate to pre-roster schema: %v", err)
	}
	insertLegacyRosterFixture(t, db)
	if err := goose.UpTo(db, migrationsDir, 10); err != nil {
		t.Fatalf("migrate roster schema: %v", err)
	}

	// Disposable DB rehearsal mirrors production application rollback: the
	// migration version moves back while expand tables/data remain available.
	if err := goose.DownTo(db, migrationsDir, 9); err != nil {
		t.Fatalf("down roster migration: %v", err)
	}
	assertMigrationTable(t, db, "multi_match_player", true)
	assertMigrationTable(t, db, "multi_round_player", true)
	assertMigrationColumn(t, db, "multi_match", "winner_member_id", true)
	assertMigrationColumn(t, db, "multi_round", "winner_member_id", true)

	var wins int
	if err := db.QueryRow(`
		SELECT wins FROM multi_match_player
		WHERE match_id = 'legacy-match' AND member_id = 'legacy-host'`).Scan(&wins); err != nil {
		t.Fatal(err)
	}
	if wins != 2 {
		t.Fatalf("expand data after Down wins = %d, want 2", wins)
	}

	if err := goose.UpTo(db, migrationsDir, 10); err != nil {
		t.Fatalf("reapply roster migration: %v", err)
	}
	var rosterCount int
	if err := db.QueryRow(`SELECT count(*) FROM multi_match_player WHERE match_id = 'legacy-match'`).Scan(&rosterCount); err != nil {
		t.Fatal(err)
	}
	if rosterCount != 2 {
		t.Fatalf("idempotent reapply roster count = %d, want 2", rosterCount)
	}
}

func insertLegacyRosterFixture(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`INSERT INTO catalog_snapshot (version, characters) VALUES ('legacy-catalog', '[]'::jsonb)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, mode, player_limit, expires_at)
		VALUES ('legacy-roster-room', 'ROSTER', 'bo3', 'finished', 'race', 2, now() + interval '1 hour')`); err != nil {
		t.Fatal(err)
	}
	for _, player := range []struct {
		id   string
		seat int
	}{
		{id: "legacy-host", seat: 1},
		{id: "legacy-guest", seat: 2},
	} {
		if _, err := db.Exec(`
			INSERT INTO multi_member (id, room_id, seat, role, display_name, token_hash)
			VALUES ($1, 'legacy-roster-room', $2, 'player', $1, $1 || '-token')`, player.id, player.seat); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`
		INSERT INTO multi_match (
			id, room_id, match_index, catalog_version, target_wins,
			score_slot1, score_slot2, round_count, status, started_at, ended_at
		) VALUES (
			'legacy-match', 'legacy-roster-room', 0, 'legacy-catalog', 2,
			2, 1, 2, 'finished', now() - interval '5 minutes', now()
		)`); err != nil {
		t.Fatal(err)
	}
	for _, round := range []struct {
		id         string
		index      int
		winnerSlot int
	}{
		{id: "legacy-round-1", index: 1, winnerSlot: 1},
		{id: "legacy-round-2", index: 2, winnerSlot: 2},
	} {
		if _, err := db.Exec(`
			INSERT INTO multi_round (
				id, match_id, round_index, answer_id, status, winner_slot,
				starts_at, deadline, ended_at
			) VALUES ($1, 'legacy-match', $2, 'answer', 'ended', $3, now() - interval '1 minute', now(), now())`,
			round.id, round.index, round.winnerSlot); err != nil {
			t.Fatal(err)
		}
	}
}

func assertMigrationTable(t *testing.T, db *sql.DB, table string, want bool) {
	t.Helper()
	var exists bool
	if err := db.QueryRow(`
		SELECT EXISTS (
			SELECT 1 FROM information_schema.tables
			WHERE table_schema = 'public' AND table_name = $1
		)`, table).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if exists != want {
		t.Fatalf("table %s exists = %v, want %v", table, exists, want)
	}
}
