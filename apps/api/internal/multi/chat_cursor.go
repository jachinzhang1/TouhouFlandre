package multi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"time"
)

type ChatCursorDirection string

const (
	ChatCursorAfter  ChatCursorDirection = "after"
	ChatCursorBefore ChatCursorDirection = "before"
)

var ErrInvalidChatCursor = errors.New("invalid chat cursor")

type ChatCursorCodec struct {
	secret []byte
}

type chatCursorPayload struct {
	Version    int                 `json:"v"`
	RoomID     string              `json:"r"`
	Position   int64               `json:"p"`
	Direction  ChatCursorDirection `json:"d"`
	Generation int64               `json:"g"`
}

func NewChatCursorCodec(secret []byte) *ChatCursorCodec {
	return &ChatCursorCodec{secret: append([]byte(nil), secret...)}
}

func (c *ChatCursorCodec) Encode(roomID string, roomCreatedAt time.Time, position int64, direction ChatCursorDirection) string {
	payload, err := json.Marshal(chatCursorPayload{
		Version: 1, RoomID: roomID, Position: position, Direction: direction,
		Generation: roomCreatedAt.UTC().UnixMicro(),
	})
	if err != nil {
		panic("multi: marshal chat cursor: " + err.Error())
	}
	encoded := base64.RawURLEncoding.EncodeToString(payload)
	mac := hmac.New(sha256.New, c.secret)
	_, _ = mac.Write([]byte("multi-chat-cursor-v1:" + encoded))
	signature := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return encoded + "." + signature
}

func (c *ChatCursorCodec) Decode(token, roomID string, roomCreatedAt time.Time, direction ChatCursorDirection) (int64, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return 0, ErrInvalidChatCursor
	}
	provided, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return 0, ErrInvalidChatCursor
	}
	mac := hmac.New(sha256.New, c.secret)
	_, _ = mac.Write([]byte("multi-chat-cursor-v1:" + parts[0]))
	if !hmac.Equal(provided, mac.Sum(nil)) {
		return 0, ErrInvalidChatCursor
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return 0, ErrInvalidChatCursor
	}
	var payload chatCursorPayload
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil || payload.Version != 1 || payload.Position < 0 ||
		payload.RoomID != roomID || payload.Direction != direction ||
		payload.Generation != roomCreatedAt.UTC().UnixMicro() {
		return 0, ErrInvalidChatCursor
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return 0, ErrInvalidChatCursor
	}
	return payload.Position, nil
}
