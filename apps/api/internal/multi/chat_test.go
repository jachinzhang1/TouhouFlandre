package multi

import (
	"strings"
	"testing"
	"time"
)

const testClientMessageID = "550e8400-e29b-41d4-a716-446655440000"

func TestNormalizeChatInput(t *testing.T) {
	got, err := NormalizeChatInput(testClientMessageID, ChatKindText, "  e\u0301\r\nline  ")
	if err != nil {
		t.Fatal(err)
	}
	if got.Content != "é\nline" {
		t.Fatalf("normalized content = %q", got.Content)
	}

	for _, input := range []string{"", "\t", "ok\u202e", "a\nb\nc\nd\ne", strings.Repeat("x", 281)} {
		if _, err := NormalizeChatInput(testClientMessageID, ChatKindText, input); err == nil {
			t.Fatalf("expected %q to be rejected", input)
		}
	}
	if _, err := NormalizeChatInput(testClientMessageID, ChatKindText, strings.Repeat("e\u0301", 280)); err != nil {
		t.Fatalf("280 grapheme clusters rejected: %v", err)
	}
	if _, err := NormalizeChatInput(testClientMessageID, ChatKindEmoji, "❤️"); err != nil {
		t.Fatalf("allowed emoji rejected: %v", err)
	}
	if _, err := NormalizeChatInput(testClientMessageID, ChatKindEmoji, "🐸"); err == nil {
		t.Fatal("custom emoji accepted")
	}
	if _, err := NormalizeChatInput(strings.ToUpper(testClientMessageID), ChatKindText, "hello"); err == nil {
		t.Fatal("non-canonical UUID accepted")
	}
}

func TestChatAuthorizationMatrix(t *testing.T) {
	if channel, ok := ChatChannelForRole("player"); !ok || channel != ChatChannelRoom {
		t.Fatal("player channel mismatch")
	}
	if channel, ok := ChatChannelForRole("spectator"); !ok || channel != ChatChannelSpectator {
		t.Fatal("spectator channel mismatch")
	}
	if !CanViewChatChannel("player", "room") || CanViewChatChannel("player", "spectator") {
		t.Fatal("player projection mismatch")
	}
	if !CanViewChatChannel("spectator", "room") || !CanViewChatChannel("spectator", "spectator") {
		t.Fatal("spectator projection mismatch")
	}
}

func TestChatCursorBindsContext(t *testing.T) {
	codec := NewChatCursorCodec([]byte("test-secret"))
	created := time.Date(2026, 8, 14, 10, 0, 0, 0, time.UTC)
	token := codec.Encode("room-a", created, 42, ChatCursorAfter)
	position, err := codec.Decode(token, "room-a", created, ChatCursorAfter)
	if err != nil || position != 42 {
		t.Fatalf("decode = %d, %v", position, err)
	}
	for _, test := range []struct {
		room      string
		createdAt time.Time
		direction ChatCursorDirection
		token     string
	}{
		{room: "room-b", createdAt: created, direction: ChatCursorAfter, token: token},
		{room: "room-a", createdAt: created.Add(time.Second), direction: ChatCursorAfter, token: token},
		{room: "room-a", createdAt: created, direction: ChatCursorBefore, token: token},
		{room: "room-a", createdAt: created, direction: ChatCursorAfter, token: token + "x"},
	} {
		if _, err := codec.Decode(test.token, test.room, test.createdAt, test.direction); err == nil {
			t.Fatal("context-mismatched cursor accepted")
		}
	}
}

func TestConsumeChatRate(t *testing.T) {
	now := time.Date(2026, 8, 14, 10, 0, 0, 0, time.UTC)
	cfg := DefaultChatRateConfig()
	first := ConsumeChatRate(ChatBucketState{}, ChatBucketState{}, cfg, now)
	if !first.Allowed || first.MemberTokens != 4 || first.RoomTokens != 19 {
		t.Fatalf("first consume = %#v", first)
	}
	zero := 0.0
	previous := now
	limited := ConsumeChatRate(
		ChatBucketState{Tokens: &zero, RefilledAt: &previous},
		ChatBucketState{}, cfg, now.Add(time.Second),
	)
	if limited.Allowed || limited.RetryAfter != time.Second {
		t.Fatalf("limited consume = %#v", limited)
	}
	roomLimited := ConsumeChatRate(
		ChatBucketState{},
		ChatBucketState{Tokens: &zero, RefilledAt: &previous}, cfg, now.Add(250*time.Millisecond),
	)
	if roomLimited.Allowed || roomLimited.RetryAfter != 250*time.Millisecond {
		t.Fatalf("room-limited consume = %#v", roomLimited)
	}
}
