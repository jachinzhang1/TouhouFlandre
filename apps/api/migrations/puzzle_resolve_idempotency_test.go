package migrations_test

import (
	"testing"

	"github.com/pressly/goose/v3"
)

func TestPuzzleResolveIdempotencyMigrationReapplyAndUniqueKey(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 22); err != nil {
		t.Fatalf("migrate disposable database to 0022: %v", err)
	}
	if err := goose.UpTo(db, migrationsDir, 23); err != nil {
		t.Fatalf("apply resolve idempotency migration: %v", err)
	}
	assertMigrationTable(t, db, "puzzle_resolve_idempotency", true)

	if _, err := db.Exec(`
		INSERT INTO puzzle_resolve_idempotency (
			idempotency_key, request_fingerprint, mode
		) VALUES ('hso005-migration-key', 'fingerprint-a', 'random')`); err != nil {
		t.Fatal(err)
	}
	_, err := db.Exec(`
		INSERT INTO puzzle_resolve_idempotency (
			idempotency_key, request_fingerprint, mode
		) VALUES ('hso005-migration-key', 'fingerprint-b', 'daily')`)
	assertPostgresCode(t, err, "23505")

	var answerColumns int
	if err := db.QueryRow(`
		SELECT count(*)::int
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'puzzle_resolve_idempotency'
		  AND (column_name LIKE '%answer%' OR column_name LIKE '%payload%')`).Scan(&answerColumns); err != nil {
		t.Fatal(err)
	}
	if answerColumns != 0 {
		t.Fatalf("idempotency table exposes %d answer/payload columns", answerColumns)
	}

	if err := goose.DownTo(db, migrationsDir, 22); err != nil {
		t.Fatalf("rollback disposable database to 0022: %v", err)
	}
	assertMigrationTable(t, db, "puzzle_resolve_idempotency", false)
	if err := goose.UpTo(db, migrationsDir, 23); err != nil {
		t.Fatalf("reapply resolve idempotency migration: %v", err)
	}
	assertMigrationTable(t, db, "puzzle_resolve_idempotency", true)
}
