package server_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/openapi"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/multi"
)

var chatIDCounter atomic.Uint64

func nextChatClientID() string {
	n := chatIDCounter.Add(1)
	return fmt.Sprintf("%08x-0000-4000-8000-%012x", n, n)
}

type chatFixture struct {
	roomID         string
	roomCode       string
	hostToken      string
	playerToken    string
	spectatorToken string
}

func createChatFixture(t *testing.T) chatFixture {
	t.Helper()
	created := createRoom(t)
	join := func(displayName string) openapi.JoinRoomResponse {
		resp, payload := request(http.MethodPost, "/api/rooms/"+created.RoomCode+"/join", map[string]string{"displayName": displayName})
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("join %s: %d %s", displayName, resp.StatusCode, payload)
		}
		var result openapi.JoinRoomResponse
		if err := json.Unmarshal(payload, &result); err != nil {
			t.Fatal(err)
		}
		return result
	}
	player := join("玩家B")
	spectator := join("观战者")
	return chatFixture{
		roomID: created.RoomId, roomCode: created.RoomCode, hostToken: string(created.GuestToken),
		playerToken: string(player.GuestToken), spectatorToken: string(spectator.GuestToken),
	}
}

func sendChat(t *testing.T, roomID, token, clientMessageID, kind, content string) (int, []byte, openapi.ChatMessage) {
	t.Helper()
	resp, payload := requestAuth(http.MethodPost, "/api/rooms/"+roomID+"/messages", token, map[string]any{
		"clientMessageId": clientMessageID, "kind": kind, "content": content,
	})
	var message openapi.ChatMessage
	if resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(payload, &message); err != nil {
			t.Fatalf("decode chat message: %v (%s)", err, payload)
		}
	}
	return resp.StatusCode, payload, message
}

func listChat(t *testing.T, roomID, token, query string) (int, []byte, openapi.ChatHistoryResponse) {
	t.Helper()
	resp, payload := requestAuth(http.MethodGet, "/api/rooms/"+roomID+"/messages"+query, token, nil)
	var history openapi.ChatHistoryResponse
	if resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(payload, &history); err != nil {
			t.Fatalf("decode chat history: %v (%s)", err, payload)
		}
	}
	return resp.StatusCode, payload, history
}

func TestChatAuthorizationIdempotencyAndSenderSnapshot(t *testing.T) {
	fixture := createChatFixture(t)
	before, err := repo.New(pool).GetRoom(ctx, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}

	clientID := nextChatClientID()
	status, payload, playerMessage := sendChat(t, fixture.roomID, fixture.playerToken, clientID, "text", "  e\u0301\r\n准备  ")
	if status != http.StatusOK || playerMessage.Content != "é\n准备" || playerMessage.Channel != openapi.Room {
		t.Fatalf("player send: %d %s %+v", status, payload, playerMessage)
	}
	status, payload, retry := sendChat(t, fixture.roomID, fixture.playerToken, clientID, "text", "é\n准备")
	if status != http.StatusOK || retry.MessageId != playerMessage.MessageId {
		t.Fatalf("idempotent retry: %d %s", status, payload)
	}
	status, payload, _ = sendChat(t, fixture.roomID, fixture.playerToken, clientID, "text", "不同内容")
	if status != http.StatusConflict || decodeError(t, payload).Code != "CHAT_IDEMPOTENCY_CONFLICT" {
		t.Fatalf("idempotency conflict: %d %s", status, payload)
	}

	status, payload, spectatorMessage := sendChat(t, fixture.roomID, fixture.spectatorToken, nextChatClientID(), "emoji", "🌸")
	if status != http.StatusOK || spectatorMessage.Channel != openapi.Spectator {
		t.Fatalf("spectator send: %d %s %+v", status, payload, spectatorMessage)
	}
	if string(payload) == "" || json.Valid(payload) == false {
		t.Fatalf("invalid public payload: %s", payload)
	}
	for _, forbidden := range []string{"clientMessageId", "token", "position"} {
		if jsonContainsKey(payload, forbidden) {
			t.Fatalf("public message leaked %s: %s", forbidden, payload)
		}
	}

	status, payload, playerHistory := listChat(t, fixture.roomID, fixture.hostToken, "")
	if status != http.StatusOK || len(playerHistory.Messages) != 1 || playerHistory.Messages[0].MessageId != playerMessage.MessageId {
		t.Fatalf("player history: %d %s %+v", status, payload, playerHistory)
	}
	status, payload, spectatorHistory := listChat(t, fixture.roomID, fixture.spectatorToken, "")
	if status != http.StatusOK || len(spectatorHistory.Messages) != 2 {
		t.Fatalf("spectator history: %d %s %+v", status, payload, spectatorHistory)
	}
	after, err := repo.New(pool).GetRoom(ctx, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	if after.EventSeq != before.EventSeq {
		t.Fatalf("chat changed game sequence: before=%d after=%d", before.EventSeq, after.EventSeq)
	}

	resp, leavePayload := requestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/leave", fixture.playerToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave: %d %s", resp.StatusCode, leavePayload)
	}
	_, _, playerHistory = listChat(t, fixture.roomID, fixture.hostToken, "")
	if len(playerHistory.Messages) != 1 || playerHistory.Messages[0].SenderDisplayName != "玩家B" {
		t.Fatalf("sender snapshot was not retained: %+v", playerHistory.Messages)
	}

	resp, invalidPayload := requestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/messages", fixture.hostToken, map[string]any{
		"clientMessageId": nextChatClientID(), "kind": "text", "content": "hello", "channel": "spectator",
	})
	if resp.StatusCode != http.StatusBadRequest || decodeError(t, invalidPayload).Code != "INVALID_REQUEST" {
		t.Fatalf("forged channel: %d %s", resp.StatusCode, invalidPayload)
	}
	status, invalidPayload, _ = sendChat(t, fixture.roomID, fixture.hostToken, nextChatClientID(), "text", "bad\u202e")
	if status != http.StatusBadRequest || decodeError(t, invalidPayload).Code != "CHAT_MESSAGE_INVALID" {
		t.Fatalf("invalid content: %d %s", status, invalidPayload)
	}
	resp, invalidPayload = requestAuth(http.MethodGet, "/api/rooms/"+fixture.roomID+"/messages?unknown=1", fixture.hostToken, nil)
	if resp.StatusCode != http.StatusBadRequest || decodeError(t, invalidPayload).Code != "INVALID_REQUEST" {
		t.Fatalf("unknown query: %d %s", resp.StatusCode, invalidPayload)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_member SET status = 'disconnected' WHERE room_id = $1 AND token_hash = $2", fixture.roomID, multi.HashToken(fixture.hostToken)); err != nil {
		t.Fatal(err)
	}
	status, invalidPayload, _ = sendChat(t, fixture.roomID, fixture.hostToken, nextChatClientID(), "text", "offline")
	if status != http.StatusForbidden || decodeError(t, invalidPayload).Code != "CHAT_SEND_FORBIDDEN" {
		t.Fatalf("disconnected send: %d %s", status, invalidPayload)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_member SET status = 'connected' WHERE room_id = $1 AND token_hash = $2", fixture.roomID, multi.HashToken(fixture.hostToken)); err != nil {
		t.Fatal(err)
	}
	resp, invalidPayload = requestAuth(http.MethodDelete, "/api/rooms/"+fixture.roomID, fixture.hostToken, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("close room: %d %s", resp.StatusCode, invalidPayload)
	}
	status, invalidPayload, _ = listChat(t, fixture.roomID, fixture.hostToken, "")
	if status != http.StatusConflict || decodeError(t, invalidPayload).Code != "ROOM_CLOSED" {
		t.Fatalf("closed history: %d %s", status, invalidPayload)
	}
}

func TestChatCursorEmptyProjectionRetentionAndRoomBinding(t *testing.T) {
	fixture := createChatFixture(t)
	status, payload, initial := listChat(t, fixture.roomID, fixture.hostToken, "")
	if status != http.StatusOK || initial.ScannedCursor == nil || len(initial.Messages) != 0 {
		t.Fatalf("empty initial history: %d %s %+v", status, payload, initial)
	}
	status, payload, _ = sendChat(t, fixture.roomID, fixture.spectatorToken, nextChatClientID(), "text", "观战消息")
	if status != http.StatusOK {
		t.Fatalf("spectator send: %d %s", status, payload)
	}
	status, payload, filtered := listChat(t, fixture.roomID, fixture.hostToken, "?after="+*initial.ScannedCursor)
	if status != http.StatusOK || len(filtered.Messages) != 0 || filtered.ScannedCursor == nil || *filtered.ScannedCursor == *initial.ScannedCursor {
		t.Fatalf("filtered cursor did not advance: %d %s %+v", status, payload, filtered)
	}

	other := createRoom(t)
	status, payload, _ = listChat(t, other.RoomId, other.GuestToken, "?after="+*filtered.ScannedCursor)
	if status != http.StatusBadRequest || decodeError(t, payload).Code != "CHAT_CURSOR_INVALID" {
		t.Fatalf("cross-room cursor: %d %s", status, payload)
	}
	status, payload, spectatorHistory := listChat(t, fixture.roomID, fixture.spectatorToken, "")
	if status != http.StatusOK || len(spectatorHistory.Messages) != 1 {
		t.Fatalf("spectator cursor source: %d %s", status, payload)
	}
	status, payload, _ = listChat(t, fixture.roomID, fixture.spectatorToken, "?before="+spectatorHistory.Messages[0].Cursor)
	if status != http.StatusBadRequest || decodeError(t, payload).Code != "CHAT_CURSOR_INVALID" {
		t.Fatalf("cursor direction swap: %d %s", status, payload)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET chat_seq = 0 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	status, payload, _ = listChat(t, fixture.roomID, fixture.hostToken, "?after="+*filtered.ScannedCursor)
	if status != http.StatusConflict || decodeError(t, payload).Code != "CHAT_CURSOR_AHEAD" {
		t.Fatalf("cursor ahead: %d %s", status, payload)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET chat_seq = 1 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}

	if _, err := pool.Exec(ctx, "UPDATE multi_chat_message SET created_at = now() - interval '25 hours' WHERE room_id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	status, payload, _ = listChat(t, fixture.roomID, fixture.hostToken, "?after="+*initial.ScannedCursor)
	if status != http.StatusGone {
		t.Fatalf("expired cursor: %d %s", status, payload)
	}
	var resync openapi.ChatResyncRequiredResponse
	if err := json.Unmarshal(payload, &resync); err != nil || resync.Code != openapi.ChatResyncRequiredResponseCodeCHATRESYNCREQUIRED {
		t.Fatalf("resync response: %v %s", err, payload)
	}
	if err := multi.NewSweeper(pool, multi.SweeperConfig{ChatRetention: 24 * time.Hour}).SweepOnce(ctx); err != nil {
		t.Fatal(err)
	}
	var remaining int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM multi_chat_message WHERE room_id = $1", fixture.roomID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("expired rows remaining=%d err=%v", remaining, err)
	}
}

func TestChatRateLimitAndRetryDoesNotConsumeAgain(t *testing.T) {
	fixture := createRoom(t)
	firstID := nextChatClientID()
	for i := 0; i < 5; i++ {
		id := nextChatClientID()
		if i == 0 {
			id = firstID
		}
		status, payload, _ := sendChat(t, fixture.RoomId, fixture.GuestToken, id, "text", fmt.Sprintf("message %d", i))
		if status != http.StatusOK {
			t.Fatalf("send %d: %d %s", i, status, payload)
		}
	}
	status, payload, _ := sendChat(t, fixture.RoomId, fixture.GuestToken, nextChatClientID(), "text", "limited")
	if status != http.StatusTooManyRequests {
		t.Fatalf("rate limit: %d %s", status, payload)
	}
	var limited openapi.RateLimitedErrorResponse
	if err := json.Unmarshal(payload, &limited); err != nil || limited.RetryAfterMs < 1 {
		t.Fatalf("rate response: %v %s", err, payload)
	}
	status, payload, _ = sendChat(t, fixture.RoomId, fixture.GuestToken, firstID, "text", "message 0")
	if status != http.StatusOK {
		t.Fatalf("idempotent retry after exhaustion: %d %s", status, payload)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM multi_chat_message WHERE room_id = $1", fixture.RoomId).Scan(&count); err != nil || count != 5 {
		t.Fatalf("message count=%d err=%v", count, err)
	}
}

func TestChatFinishedRetainedLeftMemberIsHistoryOnly(t *testing.T) {
	fixture := createChatFixture(t)
	status, payload, sent := sendChat(t, fixture.roomID, fixture.playerToken, nextChatClientID(), "text", "finished history")
	if status != http.StatusOK {
		t.Fatalf("send: %d %s", status, payload)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_room SET status = 'finished', expires_at = now() + interval '1 hour' WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, "UPDATE multi_member SET status = 'left' WHERE room_id = $1 AND token_hash = $2", fixture.roomID, multi.HashToken(fixture.playerToken)); err != nil {
		t.Fatal(err)
	}
	status, payload, history := listChat(t, fixture.roomID, fixture.playerToken, "")
	if status != http.StatusOK || len(history.Messages) != 1 || history.Messages[0].MessageId != sent.MessageId {
		t.Fatalf("retained history: %d %s %+v", status, payload, history)
	}
	status, payload, _ = sendChat(t, fixture.roomID, fixture.playerToken, nextChatClientID(), "text", "not allowed")
	if status != http.StatusForbidden || decodeError(t, payload).Code != "CHAT_SEND_FORBIDDEN" {
		t.Fatalf("retained send: %d %s", status, payload)
	}
}

func TestChatWSReplayUsesIndependentWatermark(t *testing.T) {
	fixture := createMatchFixture(t)
	status, payload, initial := fastListChat(t, fixture.roomID, fixture.hostToken)
	if status != http.StatusOK || initial.ScannedCursor == nil {
		t.Fatalf("initial chat history: %d %s", status, payload)
	}
	roomBefore, err := repo.New(pool).GetRoom(ctx, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	resp, payload := fastRequestAuth(http.MethodPost, "/api/rooms/"+fixture.roomID+"/messages", fixture.joinerToken, map[string]any{
		"clientMessageId": nextChatClientID(), "kind": "text", "content": "replay me",
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("send before ws: %d %s", resp.StatusCode, payload)
	}
	roomAfter, err := repo.New(pool).GetRoom(ctx, fixture.roomID)
	if err != nil {
		t.Fatal(err)
	}
	if roomAfter.EventSeq != roomBefore.EventSeq || roomAfter.ChatSeq != roomBefore.ChatSeq+1 {
		t.Fatalf("watermarks after chat: game %d->%d chat %d->%d", roomBefore.EventSeq, roomAfter.EventSeq, roomBefore.ChatSeq, roomAfter.ChatSeq)
	}

	conn := wsDialWithChat(t, fixture.roomID, fixture.hostToken, 0, *initial.ScannedCursor)
	hello := wsRead(t, conn)
	if hello["type"] != "hello-ok" || hello["targetChatCursor"] == nil {
		t.Fatalf("chat hello-ok: %v", hello)
	}
	var chatFrame, complete map[string]any
	for i := 0; i < 24 && complete == nil; i++ {
		message := wsRead(t, conn)
		switch message["type"] {
		case "chat.message":
			chatFrame = message
		case "sync.complete":
			complete = message
		}
	}
	if chatFrame == nil || chatFrame["content"] != "replay me" {
		t.Fatalf("missing chat replay: %v", chatFrame)
	}
	for _, forbidden := range []string{"sequence", "eventId", "payload", "clientMessageId"} {
		if _, ok := chatFrame[forbidden]; ok {
			t.Fatalf("chat frame leaked %s: %v", forbidden, chatFrame)
		}
	}
	if complete == nil || complete["chatCursor"] == nil {
		t.Fatalf("missing dual sync completion: %v", complete)
	}
}

func TestChatWSRejectsInvalidCursorBeforeBusinessFrames(t *testing.T) {
	fixture := createMatchFixture(t)
	conn := wsDialWithChat(t, fixture.roomID, fixture.hostToken, 0, "tampered")
	message := wsRead(t, conn)
	if message["type"] != "resync.required" || message["scope"] != "chat" || message["reason"] != "invalid_cursor" {
		t.Fatalf("invalid chat cursor response: %v", message)
	}
}

func TestChatWSReplayCanDrainMoreThanSendQueue(t *testing.T) {
	fixture := createMatchFixture(t)
	status, payload, initial := fastListChat(t, fixture.roomID, fixture.hostToken)
	if status != http.StatusOK || initial.ScannedCursor == nil {
		t.Fatalf("initial chat history: %d %s", status, payload)
	}
	sender, err := repo.New(pool).GetMemberByTokenHash(ctx, multi.HashToken(fixture.joinerToken))
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for i := 1; i <= 70; i++ {
		if _, err := tx.Exec(ctx, `
			INSERT INTO multi_chat_message (
				id, room_id, position, sender_member_id, sender_display_name, sender_role,
				sender_seat, client_message_id, kind, content, channel, created_at
			) VALUES ($1,$2,$3,$4,$5,'player',$6,$7::uuid,'text',$8,'room',now())`,
			fmt.Sprintf("chat%021d", i), fixture.roomID, i, sender.ID, sender.DisplayName,
			sender.Seat.Int32, nextChatClientID(), fmt.Sprintf("replay %d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := tx.Exec(ctx, "UPDATE multi_room SET chat_seq = 70 WHERE id = $1", fixture.roomID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	conn := wsDialWithChat(t, fixture.roomID, fixture.hostToken, 0, *initial.ScannedCursor)
	if hello := wsRead(t, conn); hello["type"] != "hello-ok" {
		t.Fatalf("hello = %v", hello)
	}
	chatCount := 0
	for i := 0; i < 100; i++ {
		message := wsRead(t, conn)
		if message["type"] == "chat.message" {
			chatCount++
		}
		if message["type"] == "sync.complete" {
			break
		}
	}
	if chatCount != 70 {
		t.Fatalf("chat replay count=%d, want 70", chatCount)
	}
}

func fastListChat(t *testing.T, roomID, token string) (int, []byte, openapi.ChatHistoryResponse) {
	t.Helper()
	resp, payload := fastRequestAuth(http.MethodGet, "/api/rooms/"+roomID+"/messages", token, nil)
	var history openapi.ChatHistoryResponse
	if resp.StatusCode == http.StatusOK {
		if err := json.Unmarshal(payload, &history); err != nil {
			t.Fatal(err)
		}
	}
	return resp.StatusCode, payload, history
}

func wsDialWithChat(t *testing.T, roomID, token string, lastGameSequence int64, lastChatCursor string) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, wsURL(roomID), &websocket.DialOptions{
		HTTPHeader: http.Header{"Origin": []string{wsTestOrigin}}, Subprotocols: []string{wsTestProto},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.CloseNow() })
	hello, _ := json.Marshal(multi.HelloMessage{
		Type: "hello", Token: token, LastGameSequence: lastGameSequence, LastChatCursor: &lastChatCursor,
	})
	writeCtx, writeCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer writeCancel()
	if err := conn.Write(writeCtx, websocket.MessageText, hello); err != nil {
		t.Fatal(err)
	}
	return conn
}

func jsonContainsKey(payload []byte, key string) bool {
	var value any
	if json.Unmarshal(payload, &value) != nil {
		return false
	}
	var visit func(any) bool
	visit = func(current any) bool {
		switch typed := current.(type) {
		case map[string]any:
			if _, ok := typed[key]; ok {
				return true
			}
			for _, nested := range typed {
				if visit(nested) {
					return true
				}
			}
		case []any:
			for _, nested := range typed {
				if visit(nested) {
					return true
				}
			}
		}
		return false
	}
	return visit(value)
}
