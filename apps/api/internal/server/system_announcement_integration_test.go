package server_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

func appendSystemAnnouncementTx(t *testing.T, writer *multi.SystemAnnouncementWriter, announcement multi.SystemAnnouncement) (bool, error) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	changed, err := writer.Append(ctx, repo.New(tx), announcement)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return changed, nil
}

func TestRaceCorrectCreatesOneSystemAnnouncementVisibleToPlayers(t *testing.T) {
	fixture := createMatchFixtureFormat(t, "bo1")
	resp, payload := fastRequest(http.MethodPost, "/api/rooms/"+fixture.roomCode+"/join", map[string]string{"displayName": "观战者"})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join spectator: %d %s", resp.StatusCode, payload)
	}
	var spectator openapi.JoinRoomResponse
	if err := json.Unmarshal(payload, &spectator); err != nil {
		t.Fatal(err)
	}
	startMatch(t, fixture)
	host, err := repo.New(pool).GetMemberByTokenHash(ctx, multi.HashToken(fixture.hostToken))
	if err != nil {
		t.Fatal(err)
	}
	answer := currentAnswer(t, fixture.roomID)
	resp, payload = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "system-race-correct")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("correct guess: %d %s", resp.StatusCode, payload)
	}

	status, payload, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
	if status != http.StatusOK || len(history.Messages) != 1 {
		t.Fatalf("history: %d %s %+v", status, payload, history)
	}
	message := history.Messages[0]
	want := fmt.Sprintf("[第 1 轮]%s(P1)已猜中", host.DisplayName)
	if message.SenderRole != openapi.ChatSenderSystem || message.SenderMemberId != multi.SystemChatMemberID || message.SenderDisplayName != multi.SystemChatDisplayName || message.SenderSeat != nil || message.Channel != openapi.Room || message.Content != want {
		t.Fatalf("system message=%+v want content=%q", message, want)
	}
	_, _, spectatorHistory := listChat(t, fixture.roomID, string(spectator.GuestToken), "")
	if len(spectatorHistory.Messages) != 1 || spectatorHistory.Messages[0].MessageId != message.MessageId {
		t.Fatalf("spectator did not receive system room message: %+v", spectatorHistory.Messages)
	}

	resp, _ = guess(t, fixture.roomID, fixture.hostToken, 1, answer, "system-race-correct")
	if resp.StatusCode == http.StatusOK {
		t.Fatal("terminal guess replay should be rejected by the ended round")
	}
	_, _, history = listChat(t, fixture.roomID, fixture.joinerToken, "")
	if len(history.Messages) != 1 {
		t.Fatalf("terminal retry duplicated announcement: %+v", history.Messages)
	}
}

func TestRaceExhaustForfeitDisconnectAndLeaveAnnouncementPolicy(t *testing.T) {
	t.Run("exhausted", func(t *testing.T) {
		fixture := createMatchFixtureFormat(t, "bo1")
		snapshot := startMatch(t, fixture)
		answer := currentAnswer(t, fixture.roomID)
		wrong := guessableIDs(t, answer, snapshot.Round.MaxGuesses)
		for index, guessID := range wrong {
			resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, guessID, fmt.Sprintf("system-exhaust-%d", index))
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("wrong guess %d: %d %s", index, resp.StatusCode, payload)
			}
		}
		_, _, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
		if len(history.Messages) != 1 || !strings.HasSuffix(history.Messages[0].Content, "猜测次数已耗尽") {
			t.Fatalf("exhausted history=%+v", history.Messages)
		}
	})

	t.Run("forfeited round", func(t *testing.T) {
		fixture := createMatchFixtureFormat(t, "bo1")
		startMatch(t, fixture)
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/rounds/1/forfeit", fixture.hostToken, nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("forfeit: %d %s", resp.StatusCode, payload)
		}
		_, _, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
		if len(history.Messages) != 1 || !strings.HasSuffix(history.Messages[0].Content, "已放弃本局") {
			t.Fatalf("forfeit history=%+v", history.Messages)
		}
	})

	t.Run("disconnect", func(t *testing.T) {
		fixture := createMatchFixtureFormat(t, "bo1")
		startMatch(t, fixture)
		if _, err := pool.Exec(ctx, `UPDATE multi_member SET status = 'disconnected', grace_until = now() - interval '1 second' WHERE token_hash = $1`, multi.HashToken(fixture.hostToken)); err != nil {
			t.Fatal(err)
		}
		if err := fastSweeper().SweepOnce(ctx); err != nil {
			t.Fatal(err)
		}
		_, _, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
		if len(history.Messages) != 1 || !strings.HasSuffix(history.Messages[0].Content, "已离线") {
			t.Fatalf("disconnect history=%+v", history.Messages)
		}
	})

	t.Run("leave room is silent", func(t *testing.T) {
		fixture := createMatchFixtureFormat(t, "bo1")
		startMatch(t, fixture)
		resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.hostToken, nil)
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("leave: %d %s", resp.StatusCode, payload)
		}
		_, _, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
		if len(history.Messages) != 0 {
			t.Fatalf("active room leave must not announce: %+v", history.Messages)
		}
	})
}

func TestRelayWinnerCreatesSystemAnnouncement(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 60)
	startMatch(t, fixture)
	host, err := repo.New(pool).GetMemberByTokenHash(ctx, multi.HashToken(fixture.hostToken))
	if err != nil {
		t.Fatal(err)
	}
	answer := currentAnswer(t, fixture.roomID)
	resp, payload := guess(t, fixture.roomID, fixture.hostToken, 1, answer, "system-relay-correct")
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("relay correct guess: %d %s", resp.StatusCode, payload)
	}

	status, payload, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
	if status != http.StatusOK || len(history.Messages) != 1 {
		t.Fatalf("relay history: %d %s %+v", status, payload, history)
	}
	want := fmt.Sprintf("[第 1 轮][P1 vs P2]%s(P1)胜出", host.DisplayName)
	if history.Messages[0].SenderRole != openapi.ChatSenderSystem || history.Messages[0].Content != want {
		t.Fatalf("relay system message=%+v want content=%q", history.Messages[0], want)
	}
}

func TestRelayDrawCreatesOneSystemAnnouncement(t *testing.T) {
	fixture := createMatchFixtureMode(t, "bo1", "relay", 60)
	startMatch(t, fixture)
	if _, err := pool.Exec(ctx, `UPDATE multi_relay_encounter SET deadline = now() - interval '1 second', turn_deadline = NULL WHERE match_id = (SELECT id FROM multi_match WHERE room_id = $1 AND status = 'playing')`, fixture.roomID); err != nil {
		t.Fatal(err)
	}
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	status, payload, history := listChat(t, fixture.roomID, fixture.joinerToken, "")
	if status != http.StatusOK || len(history.Messages) != 1 || history.Messages[0].Content != "[第 1 轮][P1 vs P2]双方平局" {
		t.Fatalf("relay draw history: %d %s %+v", status, payload, history.Messages)
	}
	if err := fastSweeper().SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	_, _, history = listChat(t, fixture.roomID, fixture.joinerToken, "")
	if len(history.Messages) != 1 {
		t.Fatalf("relay recovery duplicated draw: %+v", history.Messages)
	}
}

func TestSystemChatDatabaseRejectsForgedSenderSnapshots(t *testing.T) {
	fixture := createRoom(t)
	_, err := pool.Exec(ctx, `
		INSERT INTO multi_chat_message (
			id, room_id, position, sender_member_id, sender_display_name, sender_role,
			sender_seat, client_message_id, kind, content, channel, created_at
		) VALUES (
			'forgedsystemmessage0000001', $1, 1, 'system', '伪造系统', 'system',
			NULL, '00000000-0000-4000-8000-000000000020', 'text', 'forged', 'room', $2
		)`, fixture.RoomId, time.Now())
	if err == nil {
		t.Fatal("database accepted a forged system sender snapshot")
	}
}

func TestSystemAnnouncementWriterPersistsIdempotently(t *testing.T) {
	fixture := createRoom(t)
	announcement := multi.SystemAnnouncement{
		RoomID: fixture.RoomId, RosterSize: 2, TriggerKey: "test/idempotent/terminal",
		Content: "[第 1 轮]测试(P1)已猜中", CreatedAt: time.Now(),
	}
	writer := multi.NewSystemAnnouncementWriter(true)
	changed, err := appendSystemAnnouncementTx(t, writer, announcement)
	if err != nil || !changed {
		t.Fatalf("first append changed=%t err=%v", changed, err)
	}
	changed, err = appendSystemAnnouncementTx(t, writer, announcement)
	if err != nil || changed {
		t.Fatalf("idempotent append changed=%t err=%v", changed, err)
	}

	room, err := repo.New(pool).GetRoom(ctx, fixture.RoomId)
	if err != nil {
		t.Fatal(err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*)::int FROM multi_chat_message WHERE room_id = $1`, fixture.RoomId).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if room.ChatSeq != 1 || count != 1 {
		t.Fatalf("idempotent write chat_seq=%d rows=%d", room.ChatSeq, count)
	}

	conflict := announcement
	conflict.Content = "不同文案"
	if _, err := appendSystemAnnouncementTx(t, writer, conflict); err == nil {
		t.Fatal("same trigger with conflicting content must fail")
	}
}

func TestDisabledSystemAnnouncementWriterDoesNotAdvanceChat(t *testing.T) {
	fixture := createRoom(t)
	roomBefore, err := repo.New(pool).GetRoom(ctx, fixture.RoomId)
	if err != nil {
		t.Fatal(err)
	}
	changed, err := appendSystemAnnouncementTx(t, multi.NewSystemAnnouncementWriter(false), multi.SystemAnnouncement{
		RoomID: fixture.RoomId, RosterSize: 2, TriggerKey: "test/disabled/terminal",
		Content: "[第 1 轮]不会写入", CreatedAt: time.Now(),
	})
	if err != nil || changed {
		t.Fatalf("disabled append changed=%t err=%v", changed, err)
	}
	roomAfter, err := repo.New(pool).GetRoom(ctx, fixture.RoomId)
	if err != nil {
		t.Fatal(err)
	}
	if roomAfter.ChatSeq != roomBefore.ChatSeq {
		t.Fatalf("disabled append advanced chat_seq from %d to %d", roomBefore.ChatSeq, roomAfter.ChatSeq)
	}
	if _, err := repo.New(pool).GetChatMessageByIdempotency(ctx, repo.GetChatMessageByIdempotencyParams{
		RoomID: fixture.RoomId, SenderMemberID: multi.SystemChatMemberID,
		ClientMessageID: multi.SystemAnnouncementClientMessageID(fixture.RoomId, "test/disabled/terminal"),
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("disabled append persisted a row: %v", err)
	}
}
