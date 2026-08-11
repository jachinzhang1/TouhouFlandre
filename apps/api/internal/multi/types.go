// Package multi 承载多人房间领域逻辑（Phase 2 起）。
//
// 本文件为 Phase 1 交付的 WS 协议类型：与 contracts/ws/protocol.yaml 字段一一对应
// （手写维护）；payload 内一律 camelCase（08 §8.2 信封约定）。TS 侧同构类型见
// packages/shared/src/multi.ts，一致性由 scripts/check-ws-protocol.mjs 校验。
package multi

import (
	"crypto/rand"
	"encoding/json"
	"time"

	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/game"
	"github.com/TouhouFlandre/touhouflandre/apps/api/internal/generated/repo"
	"github.com/jackc/pgx/v5/pgtype"
)

// NewID 生成 25 位小写字母数字 id（同单人 newSessionID 模式，08 §9.1）。
func NewID() string {
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
	raw := make([]byte, 25)
	if _, err := rand.Read(raw); err != nil {
		panic("multi: crypto/rand unavailable: " + err.Error())
	}
	id := make([]byte, 25)
	for i, b := range raw {
		id[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(id)
}

// GameMaxGuesses is the legacy fallback when a match has no stored question scope.
var GameMaxGuesses = game.GameContentDefinition.MaxGuesses

// RelayMaxSkipsPerPlayer 接力模式每局每名玩家可空过次数上限（主动空过与超时空过共享）。
const RelayMaxSkipsPerPlayer = 2

// MemberViews 成员行 → 视图（room.updated 规范形态 / 快照共享）。
func MemberViews(rows []repo.MultiMember) []MemberView {
	views := make([]MemberView, 0, len(rows))
	for _, m := range rows {
		if !IsPlayer(m) {
			continue
		}
		views = append(views, MemberView{
			Slot:        MemberSlot(m),
			DisplayName: m.DisplayName,
			Status:      MemberStatus(m.Status),
			Ready:       m.Ready,
		})
	}
	return views
}

func MemberSlot(m repo.MultiMember) int {
	switch slot := any(m.Slot).(type) {
	case int32:
		return int(slot)
	case pgtype.Int4:
		if !slot.Valid {
			return 0
		}
		return int(slot.Int32)
	default:
		return 0
	}
}

func IsPlayer(m repo.MultiMember) bool {
	return m.Role == "" || m.Role == string(ParticipantRolePlayer)
}

func IsSpectator(m repo.MultiMember) bool {
	return m.Role == string(ParticipantRoleSpectator)
}

func ParticipantViewFor(m repo.MultiMember) ParticipantView {
	view := ParticipantView{
		Role:        ParticipantRole(m.Role),
		DisplayName: m.DisplayName,
		Status:      MemberStatus(m.Status),
	}
	if view.Role == "" {
		view.Role = ParticipantRolePlayer
	}
	if IsPlayer(m) {
		slot := MemberSlot(m)
		view.Slot = &slot
	}
	return view
}

// 房间/成员/局/对局状态与结果枚举（与 protocol.yaml 与 OpenAPI schema 对齐）。

// RoomFormat 赛制：BO_N = 先胜 (N+1)/2 局。
type RoomFormat string

const (
	RoomFormatBO1 RoomFormat = "bo1"
	RoomFormatBO3 RoomFormat = "bo3"
	RoomFormatBO5 RoomFormat = "bo5"
	RoomFormatBO7 RoomFormat = "bo7"
)

// MultiplayerMode 多人玩法模式。
type MultiplayerMode string

const (
	MultiplayerModeRace  MultiplayerMode = "race"
	MultiplayerModeRelay MultiplayerMode = "relay"
)

// RoomStatus 房间生命周期状态。
type RoomStatus string

const (
	RoomStatusLobby    RoomStatus = "lobby"
	RoomStatusPlaying  RoomStatus = "playing"
	RoomStatusFinished RoomStatus = "finished"
	RoomStatusClosed   RoomStatus = "closed"
)

// MatchStatus 场次状态。
type MatchStatus string

const (
	MatchStatusPlaying  MatchStatus = "playing"
	MatchStatusFinished MatchStatus = "finished"
)

// MemberStatus 成员连接状态。
type MemberStatus string

const (
	MemberStatusConnected    MemberStatus = "connected"
	MemberStatusDisconnected MemberStatus = "disconnected"
	MemberStatusLeft         MemberStatus = "left"
)

// ParticipantRole 区分 PK 玩家和观战者。后续扩展更多玩家席位或表情系统时，
// 优先扩展 role/slot helper，避免把“两个玩家”的假设散落到各层。
type ParticipantRole string

const (
	ParticipantRolePlayer    ParticipantRole = "player"
	ParticipantRoleSpectator ParticipantRole = "spectator"
)

// RoundStatus 单局状态。
type RoundStatus string

const (
	RoundStatusCountdown RoundStatus = "countdown"
	RoundStatusPlaying   RoundStatus = "playing"
	RoundStatusEnded     RoundStatus = "ended"
)

// MatchResult 观察者视角结果。
type MatchResult string

const (
	MatchResultWin  MatchResult = "win"
	MatchResultLoss MatchResult = "loss"
	MatchResultDraw MatchResult = "draw"
)

// MatchEndReason 对局结束原因。
type MatchEndReason string

const (
	MatchEndReasonNormal        MatchEndReason = "normal"
	MatchEndReasonForfeit       MatchEndReason = "forfeit"
	MatchEndReasonDisconnect    MatchEndReason = "disconnect"
	MatchEndReasonServerRestart MatchEndReason = "server_restart"
	MatchEndReasonRoundCap      MatchEndReason = "round_cap"
)

// RoomCloseReason 房间关闭原因。
type RoomCloseReason string

const (
	RoomCloseReasonHostLeft   RoomCloseReason = "host_left"
	RoomCloseReasonMemberLeft RoomCloseReason = "member_left"
	RoomCloseReasonTTL        RoomCloseReason = "ttl"
	RoomCloseReasonRetention  RoomCloseReason = "retention"
)

// EventType WS 事件类型（08 §8.3 全表）。
type EventType string

const (
	EventRoomUpdated         EventType = "room.updated"
	EventMatchStarted        EventType = "match.started"
	EventMatchRematch        EventType = "match.rematch"
	EventRoundStarted        EventType = "round.started"
	EventRoundPlaying        EventType = "round.playing"
	EventRoundOpponentGuess  EventType = "round.opponent.guess"
	EventRoundSpectatorGuess EventType = "round.spectator.guess"
	EventRoundSharedGuess    EventType = "round.shared.guess"
	EventRoundTurnTimeout    EventType = "round.turn.timeout"
	EventRoundTurnPass       EventType = "round.turn.pass"
	EventRoundEnded          EventType = "round.ended"
	EventMatchEnded          EventType = "match.ended"
	EventRoomClosed          EventType = "room.closed"
)

// Envelope 事件信封（08 §8.2）。Payload 为规范形态（round.opponent.guess 存真实列序），
// 逐观察者投影在扇出/快照/重放三路径共用（Phase 4）。
type Envelope struct {
	Type       EventType       `json:"type"`
	EventID    string          `json:"eventId"`
	RoomID     string          `json:"roomId"`
	Sequence   int64           `json:"sequence"`
	OccurredAt time.Time       `json:"occurredAt"`
	Payload    json.RawMessage `json:"payload"`
}

// ---- 事件 payload（与 protocol.yaml 字段一一对应） ----

// MemberView 房间成员视图。
type MemberView struct {
	Slot        int          `json:"slot"`
	DisplayName string       `json:"displayName"`
	Status      MemberStatus `json:"status"`
	Ready       bool         `json:"ready"`
}

// ParticipantView 当前访问者视图；观战者不占玩家 slot。
type ParticipantView struct {
	Role        ParticipantRole `json:"role"`
	Slot        *int            `json:"slot,omitempty"`
	DisplayName string          `json:"displayName"`
	Status      MemberStatus    `json:"status"`
}

// RoomUpdatedPayload room.updated：大厅任何成员变化/就绪。
type RoomUpdatedPayload struct {
	Format         RoomFormat      `json:"format"`
	Mode           MultiplayerMode `json:"mode"`
	TurnSeconds    int             `json:"turnSeconds"`
	Members        []MemberView    `json:"members"`
	SpectatorCount int             `json:"spectatorCount"`
}

// MatchStartedPayload match.started：新场次开始。
type MatchStartedPayload struct {
	Format         RoomFormat               `json:"format"`
	Mode           MultiplayerMode          `json:"mode"`
	TurnSeconds    int                      `json:"turnSeconds"`
	TargetWins     int                      `json:"targetWins"`
	CatalogVersion string                   `json:"catalogVersion"`
	MatchIndex     int                      `json:"matchIndex"`
	QuestionScope  game.QuestionScopeConfig `json:"questionScope"`
}

// MatchRematchPayload match.rematch：成员确认再来一局。
type MatchRematchPayload struct {
	MemberSlot int `json:"memberSlot"`
}

// RoundStartedPayload round.started：每局创建（countdown 态）。
type RoundStartedPayload struct {
	MatchIndex        int        `json:"matchIndex"`
	RoundIndex        int        `json:"roundIndex"`
	StartsAt          time.Time  `json:"startsAt"`
	Deadline          time.Time  `json:"deadline"`
	MaxGuesses        int        `json:"maxGuesses"`
	TurnSlot          *int       `json:"turnSlot,omitempty"`
	TurnDeadline      *time.Time `json:"turnDeadline,omitempty"`
	MaxTurnsPerPlayer *int       `json:"maxTurnsPerPlayer,omitempty"`
	MaxSkipsPerPlayer *int       `json:"maxSkipsPerPlayer,omitempty"`
}

// RoundPlayingPayload round.playing：倒计时结束可开猜。
type RoundPlayingPayload struct {
	MatchIndex int `json:"matchIndex"`
	RoundIndex int `json:"roundIndex"`
}

// RoundOpponentGuessPayload round.opponent.guess：对手匿名行（已按观察者列置换）。
type RoundOpponentGuessPayload struct {
	MatchIndex int      `json:"matchIndex"`
	RoundIndex int      `json:"roundIndex"`
	RowIndex   int      `json:"rowIndex"`
	Statuses   []string `json:"statuses"`
}

// RoundSpectatorGuessPayload round.spectator.guess：观战者可见的完整猜测行。
type RoundSpectatorGuessPayload struct {
	MatchIndex int             `json:"matchIndex"`
	RoundIndex int             `json:"roundIndex"`
	MemberSlot int             `json:"memberSlot"`
	RowIndex   int             `json:"rowIndex"`
	Guess      GuessResultView `json:"guess"`
}

// RelayTurnKind 接力共享棋盘行类型。
type RelayTurnKind string

const (
	RelayTurnKindGuess   RelayTurnKind = "guess"
	RelayTurnKindTimeout RelayTurnKind = "timeout"
	RelayTurnKindPass    RelayTurnKind = "pass"
)

// RelayTurnRow 接力模式共享棋盘行。
type RelayTurnRow struct {
	Index      int              `json:"index"`
	MemberSlot int              `json:"memberSlot"`
	Kind       RelayTurnKind    `json:"kind"`
	Guess      *GuessResultView `json:"guess,omitempty"`
}

// RoundSharedGuessPayload round.shared.guess：接力共享猜测行。
type RoundSharedGuessPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnSlot     *int         `json:"nextTurnSlot,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundTurnTimeoutPayload round.turn.timeout：接力超时空过行。
type RoundTurnTimeoutPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnSlot     *int         `json:"nextTurnSlot,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundTurnPassPayload round.turn.pass：接力主动空过行。
type RoundTurnPassPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnSlot     *int         `json:"nextTurnSlot,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundEndedPayload round.ended：局结束（result 为观察者视角；揭示答案与双方完整棋盘）。
type RoundEndedPayload struct {
	MatchIndex    int            `json:"matchIndex"`
	RoundIndex    int            `json:"roundIndex"`
	Result        MatchResult    `json:"result"`
	WinnerSlot    *int           `json:"winnerSlot"`
	ForfeitedSlot *int           `json:"forfeitedSlot,omitempty"`
	Answer        AnswerView     `json:"answer"`
	Boards        BoardsView     `json:"boards"`
	Turns         []RelayTurnRow `json:"turns,omitempty"`
	Scores        ScoresView     `json:"scores"`
	NextStartsAt  *time.Time     `json:"nextStartsAt,omitempty"`
}

// AnswerView 揭示的答案角色与作品快照。
type AnswerView struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
	WorkID    string `json:"workId"`
	WorkTitle string `json:"workTitle"`
	WorkCode  string `json:"workCode"`
}

// ScoresView 比分。
type ScoresView struct {
	Slot1 int `json:"slot1"`
	Slot2 int `json:"slot2"`
}

// BoardsView 双方完整棋盘（局末揭示）。
type BoardsView struct {
	Slot1 []GuessResultView `json:"slot1"`
	Slot2 []GuessResultView `json:"slot2"`
}

// GuessResultView 猜测反馈（与单人 GuessResult 同构，字段对齐 packages/shared GuessResult）。
type GuessResultView struct {
	GuessID        string              `json:"guessId"`
	GuessName      string              `json:"guessName"`
	GuessAvatarURL string              `json:"guessAvatarUrl,omitempty"`
	IsCorrect      bool                `json:"isCorrect"`
	Feedback       []FieldFeedbackView `json:"feedback"`
}

// FieldFeedbackView 字段反馈。
type FieldFeedbackView struct {
	Field        string   `json:"field"`
	Label        string   `json:"label"`
	Status       string   `json:"status"`
	Symbol       string   `json:"symbol"`
	DisplayValue []string `json:"displayValue"`
}

// MatchEndedPayload match.ended：对局结束。
type MatchEndedPayload struct {
	MatchIndex      int            `json:"matchIndex"`
	Result          MatchResult    `json:"result"`
	WinnerSlot      *int           `json:"winnerSlot"`
	Scores          ScoresView     `json:"scores"`
	Reason          MatchEndReason `json:"reason"`
	RetentionEndsAt time.Time      `json:"retentionEndsAt"`
}

// RoomClosedPayload room.closed：房间关闭（终态）。
type RoomClosedPayload struct {
	Reason RoomCloseReason `json:"reason"`
}

// ---- 规范形态事件 payload（入库；与 wire 形状的差异见各注释） ----

// RoundGuessPayload 猜测事件规范形态（入库）：真实列序 + 猜测者 slot + roundID（投影种子/水合用）。
// 投影为 wire 的 round.opponent.guess（按观察者列置换、仅推对手、剥离 memberSlot/roundID）。
type RoundGuessPayload struct {
	RoundID    string   `json:"roundId"`
	MemberID   string   `json:"memberId"`
	GuessID    string   `json:"guessId"`
	MatchIndex int      `json:"matchIndex"`
	RoundIndex int      `json:"roundIndex"`
	MemberSlot int      `json:"memberSlot"`
	RowIndex   int      `json:"rowIndex"`
	Statuses   []string `json:"statuses"`
}

// RoundEndedEventPayload 局结束事件规范形态（入库，最小化）：
// roundID + winnerSlot + 比分 + answerId；wire 的 answer/boards/result（观察者视角）由投影按快照水合/推导。
type RoundEndedEventPayload struct {
	RoundID       string     `json:"roundId"`
	MatchIndex    int        `json:"matchIndex"`
	RoundIndex    int        `json:"roundIndex"`
	WinnerSlot    *int       `json:"winnerSlot"`
	ForfeitedSlot *int       `json:"forfeitedSlot,omitempty"`
	AnswerID      string     `json:"answerId"`
	Scores        ScoresView `json:"scores"`
	// NextStartsAt 下一局 startsAt = 本局 ended_at + INTERMISSION（08 §4.3/§4.7 弹窗倒计时，
	// 服务端驱动；对局结束/无下一局时仍携带，客户端仅等待 round.started 期间使用）。
	NextStartsAt *time.Time `json:"nextStartsAt,omitempty"`
}

// MatchEndedEventPayload 对局结束事件规范形态（入库，最小化）；
// wire 的 result（观察者视角）由投影按 winnerSlot 推导。
type MatchEndedEventPayload struct {
	MatchIndex      int            `json:"matchIndex"`
	WinnerSlot      *int           `json:"winnerSlot"`
	Scores          ScoresView     `json:"scores"`
	Reason          MatchEndReason `json:"reason"`
	RetentionEndsAt time.Time      `json:"retentionEndsAt"`
}

// ---- 服务端控制帧（非事件，无 sequence；平铺消息含 type） ----

// HelloOkMessage hello-ok：鉴权通过，随后从 lastSequence+1 重放事件。
type HelloOkMessage struct {
	Type         string `json:"type"`
	RoomId       string `json:"roomId"`
	NextSequence int64  `json:"nextSequence"`
}

// ReplacedMessage replaced：同成员新连接注册，本连接被替换。
type ReplacedMessage struct {
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

// ---- 客户端消息（仅两类，平铺消息） ----

// HelloMessage hello：首帧必发；鉴权前不收发房间事件。
type HelloMessage struct {
	Type         string `json:"type"`
	Token        string `json:"token"`
	LastSequence int64  `json:"lastSequence"`
}

// AckMessage ack：水位推进。
type AckMessage struct {
	Type         string `json:"type"`
	LastSequence int64  `json:"lastSequence"`
}
