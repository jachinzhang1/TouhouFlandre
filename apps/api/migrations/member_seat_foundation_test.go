package migrations_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
)

var migrationDatabaseSequence atomic.Uint64

func TestMemberSeatMigrationPreservesExistingParticipants(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 8); err != nil {
		t.Fatalf("migrate to legacy schema: %v", err)
	}

	const roomID = "legacy-room"
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, expires_at)
		VALUES ($1, 'LEGACY', 'bo3', 'lobby', now() + interval '1 hour')`, roomID); err != nil {
		t.Fatalf("insert legacy room: %v", err)
	}
	participants := []struct {
		id          string
		slot        sql.NullInt64
		displayName string
		role        string
	}{
		{id: "legacy-host", slot: sql.NullInt64{Int64: 1, Valid: true}, displayName: "旧房主", role: "player"},
		{id: "legacy-guest", slot: sql.NullInt64{Int64: 2, Valid: true}, displayName: "旧玩家", role: "player"},
		{id: "legacy-spectator", displayName: "旧观战者", role: "spectator"},
	}
	for _, participant := range participants {
		if _, err := db.Exec(`
			INSERT INTO multi_member (id, room_id, slot, display_name, token_hash, role)
			VALUES ($1, $2, $3, $4, $5, $6)`,
			participant.id, roomID, participant.slot, participant.displayName, participant.id+"-token", participant.role); err != nil {
			t.Fatalf("insert legacy participant %s: %v", participant.id, err)
		}
	}

	if err := goose.UpTo(db, migrationsDir, 9); err != nil {
		t.Fatalf("migrate member/seat foundation: %v", err)
	}

	var playerLimit int
	if err := db.QueryRow(`SELECT player_limit FROM multi_room WHERE id = $1`, roomID).Scan(&playerLimit); err != nil {
		t.Fatalf("read migrated player limit: %v", err)
	}
	if playerLimit != 2 {
		t.Fatalf("migrated player_limit = %d, want 2", playerLimit)
	}

	rows, err := db.Query(`
		SELECT id, seat, display_name, role
		FROM multi_member
		WHERE room_id = $1
		ORDER BY role, seat NULLS LAST`, roomID)
	if err != nil {
		t.Fatalf("read migrated participants: %v", err)
	}
	defer rows.Close()

	got := make(map[string]struct {
		seat        sql.NullInt64
		displayName string
		role        string
	})
	for rows.Next() {
		var id string
		var participant struct {
			seat        sql.NullInt64
			displayName string
			role        string
		}
		if err := rows.Scan(&id, &participant.seat, &participant.displayName, &participant.role); err != nil {
			t.Fatalf("scan migrated participant: %v", err)
		}
		got[id] = participant
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate migrated participants: %v", err)
	}
	for _, want := range participants {
		participant, ok := got[want.id]
		if !ok {
			t.Fatalf("migrated participant %s is missing", want.id)
		}
		if participant.seat != want.slot || participant.displayName != want.displayName || participant.role != want.role {
			t.Errorf("migrated participant %s = %+v, want seat=%+v displayName=%q role=%q",
				want.id, participant, want.slot, want.displayName, want.role)
		}
	}
}

func newMigrationTestDatabase(t *testing.T) (*sql.DB, string) {
	t.Helper()
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve migration test path")
	}
	migrationsDir := filepath.Dir(filename)
	repoRoot := filepath.Clean(filepath.Join(migrationsDir, "..", "..", ".."))
	baseURL := os.Getenv("DATABASE_URL_PG")
	if baseURL == "" {
		baseURL = loadEnvValue(filepath.Join(repoRoot, ".env"), "DATABASE_URL_PG")
	}
	if baseURL == "" {
		t.Fatal("integration test requires DATABASE_URL_PG env or .env")
	}

	databaseName := fmt.Sprintf("touhouflandre_mpx002a_%d_%d", os.Getpid(), migrationDatabaseSequence.Add(1))
	adminDB, err := sql.Open("pgx", databaseURL(t, baseURL, "postgres"))
	if err != nil {
		t.Fatalf("open admin database: %v", err)
	}
	t.Cleanup(func() { _ = adminDB.Close() })
	identifier := pgx.Identifier{databaseName}.Sanitize()
	if _, err := adminDB.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+identifier+" WITH (FORCE)"); err != nil {
		t.Fatalf("drop stale migration test database: %v", err)
	}
	if _, err := adminDB.ExecContext(context.Background(), "CREATE DATABASE "+identifier); err != nil {
		t.Fatalf("create migration test database: %v", err)
	}

	db, err := sql.Open("pgx", databaseURL(t, baseURL, databaseName))
	if err != nil {
		t.Fatalf("open migration test database: %v", err)
	}
	if err := db.PingContext(context.Background()); err != nil {
		_ = db.Close()
		t.Fatalf("connect migration test database: %v", err)
	}
	t.Cleanup(func() {
		_ = db.Close()
		if _, err := adminDB.ExecContext(context.Background(), "DROP DATABASE IF EXISTS "+identifier+" WITH (FORCE)"); err != nil {
			t.Errorf("drop migration test database: %v", err)
		}
	})

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	return db, migrationsDir
}

func databaseURL(t *testing.T, connectionURL, databaseName string) string {
	t.Helper()
	parsed, err := url.Parse(connectionURL)
	if err != nil {
		t.Fatalf("parse database URL: %v", err)
	}
	parsed.Path = "/" + databaseName
	return parsed.String()
}

func loadEnvValue(path, key string) string {
	data, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		name, value, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(name) == key {
			return strings.Trim(strings.TrimSpace(value), `"'`)
		}
	}
	return ""
}
