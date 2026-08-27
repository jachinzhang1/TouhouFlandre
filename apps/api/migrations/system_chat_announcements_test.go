package migrations_test

import (
	"database/sql"
	"testing"

	"github.com/pressly/goose/v3"
)

func TestSystemChatAnnouncementMigrationPreservesHistoryAndExpandOnlyRollback(t *testing.T) {
	db, migrationsDir := newMigrationTestDatabase(t)
	if err := goose.UpTo(db, migrationsDir, 19); err != nil {
		t.Fatalf("migrate disposable database to 0019: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_room (id, code, format, status, mode, player_limit, expires_at, chat_seq)
		VALUES ('system-chat-room', 'SYS020', 'bo1', 'finished', 'race', 2, now() + interval '1 hour', 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_member (id, room_id, seat, role, display_name, token_hash)
		VALUES ('system-chat-player', 'system-chat-room', 1, 'player', '旧玩家', 'system-chat-player-token')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_chat_message (
			id, room_id, position, sender_member_id, sender_display_name, sender_role,
			sender_seat, client_message_id, kind, content, channel
		) VALUES (
			'pre-system-chat-message', 'system-chat-room', 1, 'system-chat-player', '旧玩家', 'player',
			1, '00000000-0000-4000-8000-000000000019', 'text', '升级前消息', 'room'
		)`); err != nil {
		t.Fatal(err)
	}

	if err := goose.UpTo(db, migrationsDir, 20); err != nil {
		t.Fatalf("apply system announcement migration: %v", err)
	}
	if _, err := db.Exec(`UPDATE multi_room SET chat_seq = 2 WHERE id = 'system-chat-room'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_chat_message (
			id, room_id, position, sender_member_id, sender_display_name, sender_role,
			sender_seat, client_message_id, kind, content, channel
		) VALUES (
			'system-chat-message', 'system-chat-room', 2, 'system', '系统', 'system',
			NULL, '00000000-0000-4000-8000-000000000020', 'text', '[第 1 轮]旧玩家(P1)已猜中', 'room'
		)`); err != nil {
		t.Fatalf("insert valid system row: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO multi_chat_message (
			id, room_id, position, sender_member_id, sender_display_name, sender_role,
			sender_seat, client_message_id, kind, content, channel
		) VALUES (
			'forged-system-chat-message', 'system-chat-room', 3, 'system', '伪造系统', 'system',
			NULL, '00000000-0000-4000-8000-000000000021', 'text', 'forged', 'room'
		)`); err == nil {
		t.Fatal("migration constraint accepted a forged system snapshot")
	}

	assertSystemChatMigrationRows(t, db)
	if err := goose.DownTo(db, migrationsDir, 19); err != nil {
		t.Fatalf("move application migration version back to 0019: %v", err)
	}
	assertSystemChatMigrationRows(t, db)
	if err := goose.UpTo(db, migrationsDir, 20); err != nil {
		t.Fatalf("reapply system announcement migration: %v", err)
	}
	assertSystemChatMigrationRows(t, db)
}

func assertSystemChatMigrationRows(t *testing.T, db *sql.DB) {
	t.Helper()
	var playerRows, systemRows int
	if err := db.QueryRow(`
		SELECT
			count(*) FILTER (WHERE sender_role = 'player')::int,
			count(*) FILTER (WHERE sender_role = 'system')::int
		FROM multi_chat_message
		WHERE room_id = 'system-chat-room'`).Scan(&playerRows, &systemRows); err != nil {
		t.Fatal(err)
	}
	if playerRows != 1 || systemRows != 1 {
		t.Fatalf("chat history rows player=%d system=%d, want 1 each", playerRows, systemRows)
	}
}
