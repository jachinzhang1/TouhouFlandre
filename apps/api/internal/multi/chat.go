package multi

import (
	"errors"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/rivo/uniseg"
	"golang.org/x/text/unicode/norm"
)

type ChatKind string

const (
	ChatKindText  ChatKind = "text"
	ChatKindEmoji ChatKind = "emoji"
)

type ChatChannel string

const (
	ChatChannelRoom      ChatChannel = "room"
	ChatChannelSpectator ChatChannel = "spectator"
)

const (
	ChatHistoryDefaultLimit = 50
	ChatHistoryMaxLimit     = 100
	ChatHistoryScanLimit    = 200
)

var ErrInvalidChatMessage = errors.New("invalid chat message")

var allowedChatEmoji = map[string]struct{}{
	"😀": {}, "😂": {}, "😍": {}, "🤔": {}, "😭": {}, "😡": {},
	"👍": {}, "👎": {}, "🎉": {}, "❤️": {}, "✨": {}, "🌸": {},
}

type NormalizedChatInput struct {
	ClientMessageID uuid.UUID
	Kind            ChatKind
	Content         string
}

func NormalizeChatInput(clientMessageID string, kind ChatKind, content string) (NormalizedChatInput, error) {
	parsedID, err := uuid.Parse(clientMessageID)
	if err != nil || parsedID.String() != clientMessageID {
		return NormalizedChatInput{}, ErrInvalidChatMessage
	}

	switch kind {
	case ChatKindText:
		content = strings.ReplaceAll(content, "\r\n", "\n")
		content = strings.ReplaceAll(content, "\r", "\n")
		content = norm.NFC.String(content)
		content = strings.TrimFunc(content, unicode.IsSpace)
		if content == "" || !utf8.ValidString(content) || len(content) > 1024 || strings.Count(content, "\n") > 3 {
			return NormalizedChatInput{}, ErrInvalidChatMessage
		}
		for _, r := range content {
			if invalidChatRune(r) {
				return NormalizedChatInput{}, ErrInvalidChatMessage
			}
		}
		if uniseg.GraphemeClusterCount(content) > 280 {
			return NormalizedChatInput{}, ErrInvalidChatMessage
		}
	case ChatKindEmoji:
		if _, ok := allowedChatEmoji[content]; !ok {
			return NormalizedChatInput{}, ErrInvalidChatMessage
		}
	default:
		return NormalizedChatInput{}, ErrInvalidChatMessage
	}

	return NormalizedChatInput{ClientMessageID: parsedID, Kind: kind, Content: content}, nil
}

func invalidChatRune(r rune) bool {
	if r == '\n' {
		return false
	}
	return r <= 0x1f || (r >= 0x7f && r <= 0x9f) ||
		(r >= 0x202a && r <= 0x202e) || (r >= 0x2066 && r <= 0x2069)
}

func ChatChannelForRole(role string) (ChatChannel, bool) {
	switch ParticipantRole(role) {
	case ParticipantRolePlayer:
		return ChatChannelRoom, true
	case ParticipantRoleSpectator:
		return ChatChannelSpectator, true
	default:
		return "", false
	}
}

func CanViewChatChannel(role string, channel string) bool {
	switch ParticipantRole(role) {
	case ParticipantRolePlayer:
		return ChatChannel(channel) == ChatChannelRoom
	case ParticipantRoleSpectator:
		return ChatChannel(channel) == ChatChannelRoom || ChatChannel(channel) == ChatChannelSpectator
	default:
		return false
	}
}

type ChatRateConfig struct {
	MemberCapacity int
	MemberRefill   time.Duration
	RoomCapacity   int
	RoomRefill     time.Duration
}

func DefaultChatRateConfig() ChatRateConfig {
	return ChatRateConfig{
		MemberCapacity: 5,
		MemberRefill:   2 * time.Second,
		RoomCapacity:   20,
		RoomRefill:     500 * time.Millisecond,
	}
}

type ChatBucketState struct {
	Tokens     *float64
	RefilledAt *time.Time
}

type ConsumedChatRate struct {
	MemberTokens float64
	RoomTokens   float64
	RefilledAt   time.Time
	RetryAfter   time.Duration
	Allowed      bool
}

func ConsumeChatRate(member, room ChatBucketState, cfg ChatRateConfig, now time.Time) ConsumedChatRate {
	memberTokens := refillChatBucket(member, cfg.MemberCapacity, cfg.MemberRefill, now)
	roomTokens := refillChatBucket(room, cfg.RoomCapacity, cfg.RoomRefill, now)
	memberWait := chatBucketWait(memberTokens, cfg.MemberRefill)
	roomWait := chatBucketWait(roomTokens, cfg.RoomRefill)
	if memberWait > 0 || roomWait > 0 {
		if roomWait > memberWait {
			memberWait = roomWait
		}
		return ConsumedChatRate{RetryAfter: memberWait}
	}
	return ConsumedChatRate{
		MemberTokens: memberTokens - 1,
		RoomTokens:   roomTokens - 1,
		RefilledAt:   now,
		Allowed:      true,
	}
}

func refillChatBucket(state ChatBucketState, capacity int, refill time.Duration, now time.Time) float64 {
	if capacity <= 0 || refill <= 0 {
		return 0
	}
	if state.Tokens == nil || state.RefilledAt == nil {
		return float64(capacity)
	}
	tokens := *state.Tokens
	if now.After(*state.RefilledAt) {
		tokens += float64(now.Sub(*state.RefilledAt)) / float64(refill)
	}
	return min(tokens, float64(capacity))
}

func chatBucketWait(tokens float64, refill time.Duration) time.Duration {
	if tokens >= 1 {
		return 0
	}
	nanos := math.Ceil((1 - tokens) * float64(refill))
	return time.Duration(nanos)
}
