// 多人模式 WebSocket 协议类型。
// 与 contracts/ws/protocol.yaml 字段一一对应（手写维护）；
// 字段名集合由 scripts/check-ws-protocol.mjs 与协议比对（`task check:ws-protocol`）。
// 依据：docs/multiplayer.md（WebSocket 协议）。

import type { FeedbackStatus, GuessFieldKey, GuessResult } from "./types";
import type { QuestionScopeConfig } from "./questionScope";

export const MULTI_ROOM_FORMATS = ["bo1", "bo3", "bo5", "bo7"] as const;
export type MultiRoomFormat = (typeof MULTI_ROOM_FORMATS)[number];

export const MULTIPLAYER_MODES = ["race", "relay"] as const;
export type MultiplayerMode = (typeof MULTIPLAYER_MODES)[number];

export const MULTI_ROOM_STATUSES = [
  "lobby",
  "playing",
  "finished",
  "closed",
] as const;
export type MultiRoomStatus = (typeof MULTI_ROOM_STATUSES)[number];

export const MULTI_MEMBER_STATUSES = [
  "connected",
  "disconnected",
  "left",
] as const;
export type MultiMemberStatus = (typeof MULTI_MEMBER_STATUSES)[number];

export const MULTI_PARTICIPANT_ROLES = ["player", "spectator"] as const;
export type MultiParticipantRole = (typeof MULTI_PARTICIPANT_ROLES)[number];

export const MULTI_ROUND_STATUSES = ["countdown", "playing", "ended"] as const;
export type MultiRoundStatus = (typeof MULTI_ROUND_STATUSES)[number];

export const MULTI_MATCH_RESULTS = ["win", "loss", "draw"] as const;
export type MultiMatchResult = (typeof MULTI_MATCH_RESULTS)[number];

export const MULTI_MATCH_END_REASONS = [
  "normal",
  "forfeit",
  "disconnect",
  "server_restart",
  "round_cap",
] as const;
export type MultiMatchEndReason = (typeof MULTI_MATCH_END_REASONS)[number];

export const MULTI_ROOM_CLOSE_REASONS = [
  "host_left",
  "member_left",
  "ttl",
  "retention",
] as const;
export type MultiRoomCloseReason = (typeof MULTI_ROOM_CLOSE_REASONS)[number];

// v3 游戏事件信封：每个 room_event.sequence 对观察者表现为业务事件或 room.cursor。
export interface Envelope<TType extends string = string, TPayload = unknown> {
  type: TType;
  eventId: string;
  roomId: string;
  sequence: number;
  occurredAt: string;
  payload: TPayload;
}

export interface RoomCursorEnvelope {
  type: "room.cursor";
  eventId: string;
  roomId: string;
  sequence: number;
  occurredAt: string;
}

export type GameSequenceFrame = Envelope | RoomCursorEnvelope;

// ---------- 事件 payload（08 §8.3 事件表） ----------

export interface MemberView {
  memberId: string;
  seat: number;
  displayName: string;
  status: MultiMemberStatus;
  ready: boolean;
}

export interface RoomUpdatedPayload {
  format: MultiRoomFormat;
  mode: MultiplayerMode;
  turnSeconds: number;
  playerLimit: number;
  raceEliminationEnabled: boolean;
  minPlayers: number;
  playerCount: number;
  availableSeats: number;
  members: MemberView[];
  spectatorCount: number;
}

export interface MatchStartedPayload {
  format: MultiRoomFormat;
  mode: MultiplayerMode;
  turnSeconds: number;
  targetWins: number;
  plannedStages?: number;
  catalogVersion: string;
  matchIndex: number;
  scoringMode?: RaceScoringMode;
  ruleSetRef: RuleSetRef;
  rosterSize?: number;
  maxRounds?: number;
  questionScope?: QuestionScopeConfig;
}

export interface MatchRematchPayload {
  memberId: string;
  seat: number;
}

export interface RoundStartedPayload {
  matchIndex: number;
  roundIndex: number;
  startsAt: string;
  deadline: string;
  maxGuesses: number;
  activePlayerCount?: number;
  turnMemberId?: string;
  turnSeat?: number;
  turnDeadline?: string;
  maxTurnsPerPlayer?: number;
  maxSkipsPerPlayer?: number;
}

export interface RoundPlayingPayload {
  matchIndex: number;
  roundIndex: number;
}

export interface RoundOpponentGuessPayload {
  matchIndex: number;
  roundIndex: number;
  memberId: string;
  seat: number;
  rowIndex: number;
  fieldOrder: GuessFieldKey[];
  statuses: FeedbackStatus[];
}

export interface RoundSpectatorGuessPayload {
  matchIndex: number;
  roundIndex: number;
  memberId: string;
  seat: number;
  rowIndex: number;
  guess: NormalizedGuessResult;
}

export type NormalizedGuessResult = GuessResult & {
  kind: NonNullable<GuessResult["kind"]>;
};

export interface RelayTurnRow {
  index: number;
  memberId: string;
  seat: number;
  kind: "guess" | "timeout" | "pass";
  guess?: NormalizedGuessResult;
}

export interface RoundSharedGuessPayload {
  matchIndex: number;
  roundIndex: number;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RoundTurnTimeoutPayload {
  matchIndex: number;
  roundIndex: number;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RoundTurnPassPayload {
  matchIndex: number;
  roundIndex: number;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RoundAnswerPayload {
  id: string;
  name: string;
  avatarUrl: string;
  workId: string;
  workTitle: string;
  workCode: string;
}

export interface RoundEndedPayload {
  matchIndex: number;
  roundIndex: number;
  viewerResult?: MultiMatchResult;
  winnerMemberId: string | null;
  forfeitedMemberId?: string;
  answer: RoundAnswerPayload;
  boards: MemberBoardView[];
  turns?: RelayTurnRow[];
  scores: MemberScoreView[];
  results: MemberResultView[];
  placements?: RoundPlacementView[];
  eliminatedMemberIds?: string[];
  /** 下一局 startsAt（本局 ended_at + INTERMISSION，服务端驱动；对局结束则为空）。 */
  nextStartsAt?: string;
}

export interface MatchEndedPayload {
  matchIndex: number;
  viewerResult?: MultiMatchResult;
  winnerMemberId: string | null;
  scores: MemberScoreView[];
  results: MemberResultView[];
  ranking?: MemberRankingView[];
  relay?: RelayMatchEndedView;
  reason: MultiMatchEndReason;
  retentionEndsAt: string;
}

export interface MemberBoardView {
  memberId: string;
  seat: number;
  guesses: GuessResult[];
}

export interface MemberScoreView {
  memberId: string;
  seat: number;
  score: number;
  status?: MatchPlayerStatus;
  bestRoundScore?: number;
  eliminatedRound?: number;
}

export type RaceScoringMode = "wins" | "points" | "placement";
export type MatchPlayerStatus = "active" | "eliminated" | "left";
export type RaceRoundParticipantStatus =
  "active" | "correct" | "forfeited" | "exhausted" | "timed_out";

export interface RoundPlacementView {
  memberId: string;
  seat: number;
  status: RaceRoundParticipantStatus;
  finishRank?: number;
  pointsAwarded: number;
}

export interface MemberRankingView {
  memberId: string;
  seat: number;
  rank: number;
  score: number;
  status: MatchPlayerStatus;
  eliminatedRound?: number;
}

export interface MemberResultView {
  memberId: string;
  seat: number;
  result: MultiMatchResult;
}

export interface RoomClosedPayload {
  reason: MultiRoomCloseReason;
}

export interface RuleSetRef {
  mode: MultiplayerMode;
  key: string;
  version: number;
}

export type RelayRuleSetRef = RuleSetRef & { mode: "relay" };

export type RelayLifeState = "healthy" | "near_death";
export type RelayLifeTransition =
  | "none"
  | "entered_near_death"
  | "eliminated";

export interface RelayStandingView {
  memberId: string;
  seat: number;
  score: number;
  status: MatchPlayerStatus;
  lifeState: RelayLifeState;
  eliminatedStage?: number;
}

export interface RelayRankingView {
  memberId: string;
  seat: number;
  rank: number;
  score: number;
  status: MatchPlayerStatus;
  lifeState: RelayLifeState;
  eliminatedStage?: number;
  survivedStages?: number;
}

export interface RelayMatchEndedView {
  standings: RelayStandingView[];
  ranking: RelayRankingView[];
}

export interface RelayEncounterMemberView {
  memberId: string;
  seat: number;
  side: 1 | 2;
}

export interface RelayEncounterSummary {
  encounterId: string;
  encounterIndex: number;
  status: "planned" | "countdown" | "playing" | "ended";
  members: RelayEncounterMemberView[];
}

export interface RelayStageSettlementView {
  memberId: string;
  encounterId?: string;
  assignment: "paired" | "bye";
  outcome: "win" | "loss" | "draw" | "bye";
  scoreBefore: number;
  scoreDelta: number;
  scoreAfter: number;
  lifeBefore: RelayLifeState;
  lifeAfter: RelayLifeState;
  lifeTransition: RelayLifeTransition;
  eliminatedStage?: number;
}

export interface RelayAnswerView {
  id: string;
  name: string;
  avatarUrl: string;
  workId: string;
  workTitle: string;
  workCode: string;
}

export interface RelayStageStartedPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  status: "planned" | "playing" | "settling" | "ended";
  encounters: RelayEncounterSummary[];
  byeMemberId?: string;
}

export interface RelayEncounterStartedPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  encounterId: string;
  encounterIndex: number;
  status: "planned" | "countdown" | "playing" | "ended";
  members: RelayEncounterMemberView[];
  startsAt?: string;
  deadline?: string;
  turnMemberId?: string;
  turnSeat?: number;
  turnDeadline?: string;
  maxTurnsPerPlayer: number;
  maxSkipsPerPlayer: number;
}

export interface RelayEncounterTurnGuessPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  encounterId: string;
  memberId: string;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RelayEncounterTurnPassPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  encounterId: string;
  memberId: string;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RelayEncounterTurnTimeoutPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  encounterId: string;
  memberId: string;
  row: RelayTurnRow;
  nextTurnMemberId?: string;
  nextTurnSeat?: number;
  nextTurnDeadline?: string;
}

export interface RelayEncounterEndedPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  encounterId: string;
  status: "ended";
  outcome: "win" | "loss" | "draw" | "forfeit" | "timeout";
  winnerMemberId: string | null;
  answer: RelayAnswerView;
  turns?: RelayTurnRow[];
}

export interface RelayStageEndedPayload {
  matchIndex: number;
  stageId: string;
  stageIndex: number;
  status: "ended";
  settlement: RelayStageSettlementView[];
  standings: RelayStandingView[];
  eliminatedMemberIds?: string[];
  nextStageIndex?: number;
  byeMemberId?: string;
}

// ---------- 服务端控制帧（非事件，无 sequence） ----------

export interface HelloOkMessage {
  type: "hello-ok";
  roomId: string;
  targetGameSequence: number;
  targetChatCursor?: string;
}

export interface SyncCompleteMessage {
  type: "sync.complete";
  gameSequence: number;
  chatCursor?: string;
}

export interface ProtocolRefreshRequiredMessage {
  type: "protocol.refresh_required";
  scope: "game" | "chat" | "all";
  reason:
    | "negative_sequence"
    | "invalid_cursor"
    | "ahead_of_server"
    | "history_unavailable"
    | "protocol_version_unsupported";
  gameSequence?: number;
  oldestAvailableChatCursor?: string;
  targetChatCursor?: string;
  requiredSubprotocol?: string;
}

export type ResyncRequiredMessage = ProtocolRefreshRequiredMessage;

export interface ReplacedMessage {
  type: "replaced";
  reason: "replaced" | "member_changed";
}

// ---------- 客户端消息（仅两类，均为平铺消息） ----------

export interface HelloMessage {
  type: "hello";
  token: string;
  lastGameSequence: number;
  lastChatCursor?: string;
}

export interface AckMessage {
  type: "ack";
  gameSequence: number;
}

export interface ChatMessageFrame {
  type: "chat.message";
  messageId: string;
  roomId: string;
  senderMemberId: string;
  senderDisplayName: string;
  senderRole: MultiParticipantRole;
  senderSeat?: number;
  kind: "text" | "emoji";
  content: string;
  channel: "room" | "spectator";
  cursor: string;
  createdAt: string;
}

export type MultiWsServerFrame =
  | GameSequenceFrame
  | ChatMessageFrame
  | HelloOkMessage
  | SyncCompleteMessage
  | ProtocolRefreshRequiredMessage
  | ReplacedMessage;

export type LegacyWsEvent =
  | Envelope<"room.updated", RoomUpdatedPayload>
  | Envelope<"match.started", MatchStartedPayload>
  | Envelope<"match.rematch", MatchRematchPayload>
  | Envelope<"round.started", RoundStartedPayload>
  | Envelope<"round.playing", RoundPlayingPayload>
  | Envelope<"round.opponent.guess", RoundOpponentGuessPayload>
  | Envelope<"round.spectator.guess", RoundSpectatorGuessPayload>
  | Envelope<"round.shared.guess", RoundSharedGuessPayload>
  | Envelope<"round.turn.timeout", RoundTurnTimeoutPayload>
  | Envelope<"round.turn.pass", RoundTurnPassPayload>
  | Envelope<"round.ended", RoundEndedPayload>
  | Envelope<"match.ended", MatchEndedPayload>
  | Envelope<"room.closed", RoomClosedPayload>;

export type RelayWsEvent =
  | Envelope<"relay.stage.started", RelayStageStartedPayload>
  | Envelope<"relay.encounter.started", RelayEncounterStartedPayload>
  | Envelope<"relay.encounter.turn.guess", RelayEncounterTurnGuessPayload>
  | Envelope<"relay.encounter.turn.pass", RelayEncounterTurnPassPayload>
  | Envelope<"relay.encounter.turn.timeout", RelayEncounterTurnTimeoutPayload>
  | Envelope<"relay.encounter.ended", RelayEncounterEndedPayload>
  | Envelope<"relay.stage.ended", RelayStageEndedPayload>;

export type MultiWsEvent = LegacyWsEvent | RelayWsEvent;

// 事件类型集合（08 §8.3 全表；round.opponent.guess 是唯一逐观察者事件）。
export const MULTI_WS_EVENT_TYPES = [
  "room.updated",
  "match.started",
  "match.rematch",
  "round.started",
  "round.playing",
  "round.opponent.guess",
  "round.spectator.guess",
  "round.shared.guess",
  "round.turn.timeout",
  "round.turn.pass",
  "round.ended",
  "match.ended",
  "room.closed",
  "relay.stage.started",
  "relay.encounter.started",
  "relay.encounter.turn.guess",
  "relay.encounter.turn.pass",
  "relay.encounter.turn.timeout",
  "relay.encounter.ended",
  "relay.stage.ended",
] as const;
export type MultiWsEventType = (typeof MULTI_WS_EVENT_TYPES)[number];
