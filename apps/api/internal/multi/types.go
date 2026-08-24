// Package multi 承载多人房间领域逻辑（Phase 2 起）。
//
// 本文件为 Phase 1 交付的 WS 协议类型：与 contracts/ws/protocol.yaml 字段一一对应
// （手写维护）；payload 内一律 camelCase（08 §8.2 信封约定）。TS 侧同构类型见
// packages/shared/src/multi.ts，一致性由 scripts/check-ws-protocol.mjs 校验。
package multi

import (
	"crypto/rand"
	"encoding/json"
	"sort"
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

const (
	// MinPlayers is the fixed minimum roster size for race and relay matches.
	MinPlayers = 2
	// DefaultPlayerLimit is the capacity used when a race room omits playerLimit.
	DefaultPlayerLimit = 2
	// ServerMaxRacePlayers is the hard upper bound for a race room.
	ServerMaxRacePlayers = 8
	// RelayPlayerLimit keeps the current relay engine on its two-player rule set.
	RelayPlayerLimit = 2
	// SpectatorCap bounds inactive room membership and websocket fan-out.
	SpectatorCap = 32
)

// MemberViews 成员行 → 视图（room.updated 规范形态 / 快照共享）。
func MemberViews(rows []repo.MultiMember) []MemberView {
	views := make([]MemberView, 0, len(rows))
	for _, m := range rows {
		if !IsPlayer(m) {
			continue
		}
		views = append(views, MemberView{
			MemberID:    m.ID,
			Seat:        MemberSeat(m),
			DisplayName: m.DisplayName,
			Status:      MemberStatus(m.Status),
			Ready:       m.Ready,
		})
	}
	sort.Slice(views, func(i, j int) bool {
		if views[i].Seat == views[j].Seat {
			return views[i].MemberID < views[j].MemberID
		}
		return views[i].Seat < views[j].Seat
	})
	return views
}

// RoomCapacityView is the shared capacity projection used by room info,
// snapshots, and room.updated. AvailableSeats represents unoccupied player
// seats; admission rules such as lobby-only claims remain separate.
type RoomCapacityView struct {
	PlayerLimit    int
	MinPlayers     int
	PlayerCount    int
	AvailableSeats int
}

// RoomCapacity derives every public capacity value from one player roster.
func RoomCapacity(playerCount, playerLimit int) RoomCapacityView {
	availableSeats := playerLimit - playerCount
	if availableSeats < 0 {
		availableSeats = 0
	}
	return RoomCapacityView{
		PlayerLimit:    playerLimit,
		MinPlayers:     MinPlayers,
		PlayerCount:    playerCount,
		AvailableSeats: availableSeats,
	}
}

func MemberSeat(m repo.MultiMember) int {
	switch seat := any(m.Seat).(type) {
	case int32:
		return int(seat)
	case pgtype.Int4:
		if !seat.Valid {
			return 0
		}
		return int(seat.Int32)
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
		MemberID:    m.ID,
		Role:        ParticipantRole(m.Role),
		DisplayName: m.DisplayName,
		Status:      MemberStatus(m.Status),
	}
	if view.Role == "" {
		view.Role = ParticipantRolePlayer
	}
	if IsPlayer(m) {
		seat := MemberSeat(m)
		view.Seat = &seat
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

type ScoringMode string

const (
	ScoringModeWins      ScoringMode = "wins"
	ScoringModePoints    ScoringMode = "points"
	ScoringModePlacement ScoringMode = "placement"
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
	EventRoomUpdated               EventType = "room.updated"
	EventMatchStarted              EventType = "match.started"
	EventMatchRematch              EventType = "match.rematch"
	EventRoundStarted              EventType = "round.started"
	EventRoundPlaying              EventType = "round.playing"
	EventRoundOpponentGuess        EventType = "round.opponent.guess"
	EventRoundSpectatorGuess       EventType = "round.spectator.guess"
	EventRoundSharedGuess          EventType = "round.shared.guess"
	EventRoundTurnTimeout          EventType = "round.turn.timeout"
	EventRoundTurnPass             EventType = "round.turn.pass"
	EventRoundEnded                EventType = "round.ended"
	EventMatchEnded                EventType = "match.ended"
	EventRoomClosed                EventType = "room.closed"
	EventRelayStageStarted         EventType = "relay.stage.started"
	EventRelayEncounterStarted     EventType = "relay.encounter.started"
	EventRelayEncounterTurnGuess   EventType = "relay.encounter.turn.guess"
	EventRelayEncounterTurnPass    EventType = "relay.encounter.turn.pass"
	EventRelayEncounterTurnTimeout EventType = "relay.encounter.turn.timeout"
	EventRelayEncounterEnded       EventType = "relay.encounter.ended"
	EventRelayStageEnded           EventType = "relay.stage.ended"
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

// CursorEnvelope 为观察者隐藏或无需消费的业务事件保留连续 sequence，不携带 payload。
type CursorEnvelope struct {
	Type       string    `json:"type"`
	EventID    string    `json:"eventId"`
	RoomID     string    `json:"roomId"`
	Sequence   int64     `json:"sequence"`
	OccurredAt time.Time `json:"occurredAt"`
}

// ---- 事件 payload（与 protocol.yaml 字段一一对应） ----

// MemberView 房间成员视图。
type MemberView struct {
	MemberID    string       `json:"memberId"`
	Seat        int          `json:"seat"`
	DisplayName string       `json:"displayName"`
	Status      MemberStatus `json:"status"`
	Ready       bool         `json:"ready"`
}

// ParticipantView 当前访问者视图；观战者不占玩家 seat。
type ParticipantView struct {
	MemberID    string          `json:"memberId"`
	Role        ParticipantRole `json:"role"`
	Seat        *int            `json:"seat,omitempty"`
	DisplayName string          `json:"displayName"`
	Status      MemberStatus    `json:"status"`
}

// RoomUpdatedPayload room.updated：大厅任何成员变化/就绪。
type RoomUpdatedPayload struct {
	Format                 RoomFormat      `json:"format"`
	Mode                   MultiplayerMode `json:"mode"`
	TurnSeconds            int             `json:"turnSeconds"`
	PlayerLimit            int             `json:"playerLimit"`
	RaceEliminationEnabled bool            `json:"raceEliminationEnabled"`
	MinPlayers             int             `json:"minPlayers"`
	PlayerCount            int             `json:"playerCount"`
	AvailableSeats         int             `json:"availableSeats"`
	Members                []MemberView    `json:"members"`
	SpectatorCount         int             `json:"spectatorCount"`
}

// NewRoomUpdatedPayload keeps the event projection identical across request,
// websocket disconnect, and sweeper paths.
func NewRoomUpdatedPayload(room repo.MultiRoom, members []repo.MultiMember, spectatorCount int) RoomUpdatedPayload {
	views := MemberViews(members)
	capacity := RoomCapacity(len(views), int(room.PlayerLimit))
	return RoomUpdatedPayload{
		Format:                 RoomFormat(room.Format),
		Mode:                   MultiplayerMode(room.Mode),
		TurnSeconds:            int(room.TurnSeconds),
		PlayerLimit:            capacity.PlayerLimit,
		RaceEliminationEnabled: room.RaceEliminationEnabled,
		MinPlayers:             capacity.MinPlayers,
		PlayerCount:            capacity.PlayerCount,
		AvailableSeats:         capacity.AvailableSeats,
		Members:                views,
		SpectatorCount:         spectatorCount,
	}
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
	ScoringMode    ScoringMode              `json:"scoringMode"`
	RuleSetRef     RuleSetRefView           `json:"ruleSetRef"`
	RosterSize     int                      `json:"rosterSize"`
	MaxRounds      int                      `json:"maxRounds"`
}

// RuleSetRefView is the wire representation of a frozen ruleset identity.
type RuleSetRefView struct {
	Mode    MultiplayerMode `json:"mode"`
	Key     string          `json:"key"`
	Version int             `json:"version"`
}

// MatchRematchPayload match.rematch：成员确认再来一局。
type MatchRematchPayload struct {
	MemberID string `json:"memberId"`
	Seat     int    `json:"seat"`
}

// RoundStartedPayload round.started：每局创建（countdown 态）。
type RoundStartedPayload struct {
	MatchIndex        int        `json:"matchIndex"`
	RoundIndex        int        `json:"roundIndex"`
	StartsAt          time.Time  `json:"startsAt"`
	Deadline          time.Time  `json:"deadline"`
	MaxGuesses        int        `json:"maxGuesses"`
	TurnMemberID      *string    `json:"turnMemberId,omitempty"`
	TurnSeat          *int       `json:"turnSeat,omitempty"`
	TurnDeadline      *time.Time `json:"turnDeadline,omitempty"`
	MaxTurnsPerPlayer *int       `json:"maxTurnsPerPlayer,omitempty"`
	MaxSkipsPerPlayer *int       `json:"maxSkipsPerPlayer,omitempty"`
	ActivePlayerCount int        `json:"activePlayerCount,omitempty"`
}

// RoundPlayingPayload round.playing：倒计时结束可开猜。
type RoundPlayingPayload struct {
	MatchIndex int `json:"matchIndex"`
	RoundIndex int `json:"roundIndex"`
}

// RoundOpponentGuessPayload round.opponent.guess：对手匿名行（已按观察者列置换）。
type RoundOpponentGuessPayload struct {
	MatchIndex int                  `json:"matchIndex"`
	RoundIndex int                  `json:"roundIndex"`
	MemberID   string               `json:"memberId"`
	Seat       int                  `json:"seat"`
	RowIndex   int                  `json:"rowIndex"`
	FieldOrder []game.GuessFieldKey `json:"fieldOrder"`
	Statuses   []string             `json:"statuses"`
}

// RoundSpectatorGuessPayload round.spectator.guess：观战者可见的完整猜测行。
type RoundSpectatorGuessPayload struct {
	MatchIndex int             `json:"matchIndex"`
	RoundIndex int             `json:"roundIndex"`
	MemberID   string          `json:"memberId"`
	Seat       int             `json:"seat"`
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
	Index    int              `json:"index"`
	MemberID string           `json:"memberId"`
	Seat     int              `json:"seat"`
	Kind     RelayTurnKind    `json:"kind"`
	Guess    *GuessResultView `json:"guess,omitempty"`
}

type RelayLifeState string

const (
	RelayLifeHealthy   RelayLifeState = "healthy"
	RelayLifeNearDeath RelayLifeState = "near_death"
)

type RelayStandingView struct {
	MemberID        string         `json:"memberId"`
	Seat            int            `json:"seat"`
	Score           int            `json:"score"`
	Status          string         `json:"status"`
	LifeState       RelayLifeState `json:"lifeState"`
	EliminatedStage *int           `json:"eliminatedStage,omitempty"`
}

type RelayEncounterMemberView struct {
	MemberID string `json:"memberId"`
	Seat     int    `json:"seat"`
	Side     int    `json:"side"`
}

type RelayEncounterSummary struct {
	EncounterID    string                     `json:"encounterId"`
	EncounterIndex int                        `json:"encounterIndex"`
	Status         string                     `json:"status"`
	Members        []RelayEncounterMemberView `json:"members"`
}

type RelayStageSettlementView struct {
	MemberID        string         `json:"memberId"`
	EncounterID     *string        `json:"encounterId,omitempty"`
	Assignment      string         `json:"assignment"`
	Outcome         string         `json:"outcome"`
	ScoreBefore     int            `json:"scoreBefore"`
	ScoreDelta      int            `json:"scoreDelta"`
	ScoreAfter      int            `json:"scoreAfter"`
	LifeBefore      RelayLifeState `json:"lifeBefore"`
	LifeAfter       RelayLifeState `json:"lifeAfter"`
	EliminatedStage *int           `json:"eliminatedStage,omitempty"`
}

type RelayStageStartedPayload struct {
	MatchIndex  int                     `json:"matchIndex"`
	StageID     string                  `json:"stageId"`
	StageIndex  int                     `json:"stageIndex"`
	Status      string                  `json:"status"`
	Encounters  []RelayEncounterSummary `json:"encounters"`
	ByeMemberID *string                 `json:"byeMemberId,omitempty"`
}

type RelayEncounterStartedPayload struct {
	MatchIndex        int                        `json:"matchIndex"`
	StageID           string                     `json:"stageId"`
	StageIndex        int                        `json:"stageIndex"`
	EncounterID       string                     `json:"encounterId"`
	EncounterIndex    int                        `json:"encounterIndex"`
	Status            string                     `json:"status"`
	Members           []RelayEncounterMemberView `json:"members"`
	StartsAt          *time.Time                 `json:"startsAt,omitempty"`
	Deadline          *time.Time                 `json:"deadline,omitempty"`
	TurnMemberID      *string                    `json:"turnMemberId,omitempty"`
	TurnSeat          *int                       `json:"turnSeat,omitempty"`
	TurnDeadline      *time.Time                 `json:"turnDeadline,omitempty"`
	MaxTurnsPerPlayer int                        `json:"maxTurnsPerPlayer"`
	MaxSkipsPerPlayer int                        `json:"maxSkipsPerPlayer"`
}

type RelayEncounterTurnPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	StageID          string       `json:"stageId"`
	StageIndex       int          `json:"stageIndex"`
	EncounterID      string       `json:"encounterId"`
	MemberID         string       `json:"memberId"`
	Row              RelayTurnRow `json:"row"`
	NextTurnMemberID *string      `json:"nextTurnMemberId,omitempty"`
	NextTurnSeat     *int         `json:"nextTurnSeat,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

type RelayEncounterEndedPayload struct {
	MatchIndex     int            `json:"matchIndex"`
	StageID        string         `json:"stageId"`
	StageIndex     int            `json:"stageIndex"`
	EncounterID    string         `json:"encounterId"`
	Status         string         `json:"status"`
	Outcome        string         `json:"outcome"`
	WinnerMemberID *string        `json:"winnerMemberId"`
	Answer         AnswerView     `json:"answer"`
	Turns          []RelayTurnRow `json:"turns,omitempty"`
}

type RelayStageEndedPayload struct {
	MatchIndex     int                        `json:"matchIndex"`
	StageID        string                     `json:"stageId"`
	StageIndex     int                        `json:"stageIndex"`
	Status         string                     `json:"status"`
	Settlement     []RelayStageSettlementView `json:"settlement"`
	Standings      []RelayStandingView        `json:"standings"`
	NextStageIndex *int                       `json:"nextStageIndex,omitempty"`
	ByeMemberID    *string                    `json:"byeMemberId,omitempty"`
}

// RoundSharedGuessPayload round.shared.guess：接力共享猜测行。
type RoundSharedGuessPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnMemberID *string      `json:"nextTurnMemberId,omitempty"`
	NextTurnSeat     *int         `json:"nextTurnSeat,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundTurnTimeoutPayload round.turn.timeout：接力超时空过行。
type RoundTurnTimeoutPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnMemberID *string      `json:"nextTurnMemberId,omitempty"`
	NextTurnSeat     *int         `json:"nextTurnSeat,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundTurnPassPayload round.turn.pass：接力主动空过行。
type RoundTurnPassPayload struct {
	MatchIndex       int          `json:"matchIndex"`
	RoundIndex       int          `json:"roundIndex"`
	Row              RelayTurnRow `json:"row"`
	NextTurnMemberID *string      `json:"nextTurnMemberId,omitempty"`
	NextTurnSeat     *int         `json:"nextTurnSeat,omitempty"`
	NextTurnDeadline *time.Time   `json:"nextTurnDeadline,omitempty"`
}

// RoundEndedPayload round.ended：局结束（viewerResult 为观察者视角；揭示答案与成员棋盘集合）。
type RoundEndedPayload struct {
	MatchIndex          int                  `json:"matchIndex"`
	RoundIndex          int                  `json:"roundIndex"`
	ViewerResult        *MatchResult         `json:"viewerResult,omitempty"`
	WinnerMemberID      *string              `json:"winnerMemberId"`
	ForfeitedMemberID   *string              `json:"forfeitedMemberId,omitempty"`
	Answer              AnswerView           `json:"answer"`
	Boards              []MemberBoardView    `json:"boards"`
	Turns               []RelayTurnRow       `json:"turns,omitempty"`
	Scores              []MemberScoreView    `json:"scores"`
	Results             []MemberResultView   `json:"results"`
	NextStartsAt        *time.Time           `json:"nextStartsAt,omitempty"`
	Placements          []RoundPlacementView `json:"placements,omitempty"`
	EliminatedMemberIDs []string             `json:"eliminatedMemberIds,omitempty"`
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

// ScoresView is the legacy two-column score stored in canonical events until MPX-004.
type ScoresView struct {
	Slot1 int `json:"slot1"`
	Slot2 int `json:"slot2"`
}

// MemberBoardView is one public board in seat order.
type MemberBoardView struct {
	MemberID string            `json:"memberId"`
	Seat     int               `json:"seat"`
	Guesses  []GuessResultView `json:"guesses"`
}

// MemberScoreView is one public score in seat order.
type MemberScoreView struct {
	MemberID        string `json:"memberId"`
	Seat            int    `json:"seat"`
	Score           int    `json:"score"`
	Status          string `json:"status,omitempty"`
	BestRoundScore  int    `json:"bestRoundScore,omitempty"`
	EliminatedRound *int   `json:"eliminatedRound,omitempty"`
}

type RoundPlacementView struct {
	MemberID      string `json:"memberId"`
	Seat          int    `json:"seat"`
	Status        string `json:"status"`
	FinishRank    *int   `json:"finishRank,omitempty"`
	PointsAwarded int    `json:"pointsAwarded"`
}

type MemberRankingView struct {
	MemberID        string `json:"memberId"`
	Seat            int    `json:"seat"`
	Rank            int    `json:"rank"`
	Score           int    `json:"score"`
	Status          string `json:"status"`
	EliminatedRound *int   `json:"eliminatedRound,omitempty"`
}

// MemberResultView is one public result in seat order.
type MemberResultView struct {
	MemberID string      `json:"memberId"`
	Seat     int         `json:"seat"`
	Result   MatchResult `json:"result"`
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
	MatchIndex      int                 `json:"matchIndex"`
	ViewerResult    *MatchResult        `json:"viewerResult,omitempty"`
	WinnerMemberID  *string             `json:"winnerMemberId"`
	Scores          []MemberScoreView   `json:"scores"`
	Results         []MemberResultView  `json:"results"`
	Reason          MatchEndReason      `json:"reason"`
	RetentionEndsAt time.Time           `json:"retentionEndsAt"`
	Ranking         []MemberRankingView `json:"ranking,omitempty"`
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
	RoundID           string            `json:"roundId"`
	MatchIndex        int               `json:"matchIndex"`
	RoundIndex        int               `json:"roundIndex"`
	WinnerMemberID    *string           `json:"winnerMemberId,omitempty"`
	ForfeitedMemberID *string           `json:"forfeitedMemberId,omitempty"`
	MemberScores      []MemberScoreView `json:"memberScores,omitempty"`
	WinnerSlot        *int              `json:"winnerSlot,omitempty"`
	ForfeitedSlot     *int              `json:"forfeitedSlot,omitempty"`
	AnswerID          string            `json:"answerId"`
	Scores            ScoresView        `json:"scores"`
	// NextStartsAt 下一局 startsAt = 本局 ended_at + INTERMISSION（08 §4.3/§4.7 弹窗倒计时，
	// 服务端驱动；对局结束/无下一局时仍携带，客户端仅等待 round.started 期间使用）。
	NextStartsAt        *time.Time           `json:"nextStartsAt,omitempty"`
	Placements          []RoundPlacementView `json:"placements,omitempty"`
	EliminatedMemberIDs []string             `json:"eliminatedMemberIds,omitempty"`
}

// MatchEndedEventPayload 对局结束事件规范形态（入库，最小化）；
// wire 的 result（观察者视角）由投影按 winnerSlot 推导。
type MatchEndedEventPayload struct {
	MatchIndex      int                 `json:"matchIndex"`
	WinnerMemberID  *string             `json:"winnerMemberId,omitempty"`
	MemberScores    []MemberScoreView   `json:"memberScores,omitempty"`
	WinnerSlot      *int                `json:"winnerSlot,omitempty"`
	Scores          ScoresView          `json:"scores"`
	Reason          MatchEndReason      `json:"reason"`
	RetentionEndsAt time.Time           `json:"retentionEndsAt"`
	Ranking         []MemberRankingView `json:"ranking,omitempty"`
}

// ---- 服务端控制帧（非事件，无 sequence；平铺消息含 type） ----

// HelloOkMessage hello-ok：鉴权通过并声明本次同步目标，不表示重放已完成。
type HelloOkMessage struct {
	Type               string  `json:"type"`
	RoomID             string  `json:"roomId"`
	TargetGameSequence int64   `json:"targetGameSequence"`
	TargetChatCursor   *string `json:"targetChatCursor,omitempty"`
}

// SyncCompleteMessage 标记 FIFO 中此前游戏帧已交付，可确认完成水位。
type SyncCompleteMessage struct {
	Type         string  `json:"type"`
	GameSequence int64   `json:"gameSequence"`
	ChatCursor   *string `json:"chatCursor,omitempty"`
}

// ProtocolRefreshRequiredMessage 要求客户端以权威 snapshot 重置游戏水位。
type ProtocolRefreshRequiredMessage struct {
	Type                      string  `json:"type"`
	Scope                     string  `json:"scope"`
	Reason                    string  `json:"reason"`
	GameSequence              *int64  `json:"gameSequence,omitempty"`
	OldestAvailableChatCursor *string `json:"oldestAvailableChatCursor,omitempty"`
	TargetChatCursor          *string `json:"targetChatCursor,omitempty"`
	RequiredSubprotocol       *string `json:"requiredSubprotocol,omitempty"`
}

// ResyncRequiredMessage 保留 Go 侧别名，避免旧内部调用者在 v3 切换期间失去类型兼容。
type ResyncRequiredMessage = ProtocolRefreshRequiredMessage

// ReplacedMessage replaced：同成员新连接注册，本连接被替换。
type ReplacedMessage struct {
	Type   string `json:"type"`
	Reason string `json:"reason"`
}

// ---- 客户端消息（仅两类，平铺消息） ----

// HelloMessage hello：首帧必发；鉴权前不收发房间事件。
type HelloMessage struct {
	Type             string  `json:"type"`
	Token            string  `json:"token"`
	LastGameSequence int64   `json:"lastGameSequence"`
	LastChatCursor   *string `json:"lastChatCursor,omitempty"`
}

// AckMessage ack：水位推进。
type AckMessage struct {
	Type         string `json:"type"`
	GameSequence int64  `json:"gameSequence"`
}

// ChatMessageFrame 是独立聊天位置的公开平铺帧，不携带游戏 sequence。
type ChatMessageFrame struct {
	Type              string          `json:"type"`
	MessageID         string          `json:"messageId"`
	RoomID            string          `json:"roomId"`
	SenderMemberID    string          `json:"senderMemberId"`
	SenderDisplayName string          `json:"senderDisplayName"`
	SenderRole        ParticipantRole `json:"senderRole"`
	SenderSeat        *int            `json:"senderSeat,omitempty"`
	Kind              ChatKind        `json:"kind"`
	Content           string          `json:"content"`
	Channel           ChatChannel     `json:"channel"`
	Cursor            string          `json:"cursor"`
	CreatedAt         time.Time       `json:"createdAt"`
}
