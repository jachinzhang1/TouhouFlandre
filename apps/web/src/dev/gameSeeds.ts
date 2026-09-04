import {
  CHARACTER_GUESS_FIELDS,
  QUESTION_SCOPE_SCHEMA_VERSION,
  type Character,
  type FeedbackStatus,
  type FieldFeedback,
  type NormalizedGuessResult,
  type PublicGameSession,
  type QuestionDifficultyPreset,
  type QuestionScopeConfig,
  type RoundEndedPayload,
  type SinglePlayerGameMode,
} from "@touhouflandre/shared";
import type { RoomUiState } from "../hooks/useRoom";
import { initialRoomChatState } from "../domain/multiChat";

export const SINGLE_GAME_SEED_PRESETS = [
  "loading",
  "error",
  "empty",
  "first-guess",
  "playing",
  "won",
  "lost",
] as const;
export type SingleGameSeedPreset = (typeof SINGLE_GAME_SEED_PRESETS)[number];

export const SINGLE_GAME_RESULT_SEEDS = ["won", "lost"] as const;
export type SingleGameResultSeed = (typeof SINGLE_GAME_RESULT_SEEDS)[number];

export const MULTIPLAYER_GAME_SEED_PRESETS = [
  "syncing-identity",
  "syncing-spectator",
  "syncing-room",
  "reconnecting",
  "viewer-disconnected",
  "tab-conflict",
  "guess-error",
  "lobby-alone",
  "lobby-waiting",
  "lobby-self-ready",
  "lobby-ready",
  "lobby-nonhost",
  "lobby-relay",
  "lobby-spectator-open",
  "lobby-spectator-full",
  "race-countdown",
  "race-between-rounds",
  "race-empty",
  "race-playing",
  "race-correct",
  "race-forfeited",
  "race-exhausted",
  "race-timed-out",
  "race-n-player",
  "race-round-result",
  "race-round-loss",
  "race-round-draw",
  "race-placement-result",
  "race-final-round-result",
  "race-match-result",
  "race-match-loss",
  "race-match-ranking",
  "race-spectator-playing",
  "race-spectator-result",
  "race-spectator-finished",
  "race-eliminated",
  "relay-countdown",
  "relay-between-rounds",
  "relay-playing",
  "relay-opponent-turn",
  "relay-no-skips",
  "relay-round-result",
  "relay-round-loss",
  "relay-round-forfeit",
  "relay-match-result",
  "relay-spectator-playing",
  "relay-spectator-result",
  "chat-empty",
  "chat-loading",
  "chat-history-error",
  "chat-history-more",
  "chat-sending",
  "chat-send-failed",
] as const;
export type MultiplayerGameSeedPreset =
  (typeof MULTIPLAYER_GAME_SEED_PRESETS)[number];

export const MULTIPLAYER_DEVELOPMENT_ROOM_CODE = "DEV222";
const MULTIPLAYER_SEED_STORAGE_KEY = "touhouflandre:dev:multiplayer-seed";
const CATALOG_VERSION = "development-game-seed";
const SELF_MEMBER_ID = "development-self";
const OPPONENT_MEMBER_ID = "development-opponent";
const THIRD_MEMBER_ID = "development-third";
const FOURTH_MEMBER_ID = "development-fourth";
const SPECTATOR_MEMBER_ID = "development-spectator";

export interface SingleGameSeed {
  session: PublicGameSession | null;
  puzzleLabel: string;
  loading: boolean;
  message: string;
  initialElapsedMs: number;
  guessCompletedElapsedMs: number[];
  dailyDifficulty: QuestionDifficultyPreset;
  dailyStatuses: Record<
    QuestionDifficultyPreset,
    "won" | "lost" | "playing" | null
  >;
}

export interface MultiplayerGameSeed {
  state: RoomUiState;
  mySlot: 1 | 2;
  memberId: string;
  role: "player" | "spectator";
  guessError: string;
}

export interface GameSeedConsole {
  readonly page: "singleplayer" | "multiplayer";
  readonly presets: readonly string[];
  readonly resultPresets?: readonly string[];
  seed: (preset?: string) => string;
  seedResult?: (result?: string) => Promise<string>;
  reset: () => void;
}

declare global {
  interface TouhouFlandreDevelopmentTools {
    game?: GameSeedConsole;
  }
}

export function installGameSeedConsole(
  controller: GameSeedConsole,
): () => void {
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return () => undefined;
  }

  const tools = (window.__touhouflandreDev ??= {});
  const previousController = tools.game;
  tools.game = controller;
  return () => {
    if (tools.game === controller) {
      if (previousController) tools.game = previousController;
      else delete tools.game;
    }
    if (Object.keys(tools).length === 0 && window.__touhouflandreDev === tools)
      delete window.__touhouflandreDev;
  };
}

export function parseSingleGameSeedPreset(
  value: string | undefined,
): SingleGameSeedPreset {
  const preset = value ?? "playing";
  if (isSingleGameSeedPreset(preset)) return preset;
  throw new Error(
    `Unknown singleplayer seed "${preset}". Available: ${SINGLE_GAME_SEED_PRESETS.join(", ")}`,
  );
}

export function parseSingleGameResultSeed(
  value: string | undefined,
): SingleGameResultSeed {
  const result = value ?? "won";
  if ((SINGLE_GAME_RESULT_SEEDS as readonly string[]).includes(result)) {
    return result as SingleGameResultSeed;
  }
  throw new Error(
    `Unknown singleplayer result seed "${result}". Available: ${SINGLE_GAME_RESULT_SEEDS.join(", ")}`,
  );
}

export function parseMultiplayerGameSeedPreset(
  value: string | undefined,
): MultiplayerGameSeedPreset {
  const preset = value ?? "race-playing";
  if (isMultiplayerGameSeedPreset(preset)) return preset;
  throw new Error(
    `Unknown multiplayer seed "${preset}". Available: ${MULTIPLAYER_GAME_SEED_PRESETS.join(", ")}`,
  );
}

export function storeMultiplayerGameSeed(
  preset: MultiplayerGameSeedPreset,
): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(MULTIPLAYER_SEED_STORAGE_KEY, preset);
}

export function loadMultiplayerGameSeed(): MultiplayerGameSeedPreset | null {
  if (typeof window === "undefined") return null;
  const value = window.sessionStorage.getItem(MULTIPLAYER_SEED_STORAGE_KEY);
  if (value && isMultiplayerGameSeedPreset(value)) return value;
  if (value) window.sessionStorage.removeItem(MULTIPLAYER_SEED_STORAGE_KEY);
  return null;
}

export function clearMultiplayerGameSeed(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(MULTIPLAYER_SEED_STORAGE_KEY);
}

export function buildSingleGameSeed(
  preset: SingleGameSeedPreset,
  mode: SinglePlayerGameMode,
  now = new Date(),
): SingleGameSeed {
  const dailyDifficulty: QuestionDifficultyPreset = "hard";
  const common = {
    puzzleLabel: `UI 调试种子 · ${preset}`,
    dailyDifficulty,
    dailyStatuses: {
      easy: "won",
      normal: "playing",
      hard: preset === "lost" ? "lost" : preset === "won" ? "won" : "playing",
      lunatic: "lost",
      extra: null,
    } satisfies SingleGameSeed["dailyStatuses"],
  };

  if (preset === "loading") {
    return {
      ...common,
      session: null,
      loading: true,
      message: "",
      initialElapsedMs: 0,
      guessCompletedElapsedMs: [],
    };
  }
  if (preset === "error") {
    return {
      ...common,
      session: null,
      loading: false,
      message: "调试种子：题局加载失败，请检查错误状态布局。",
      initialElapsedMs: 0,
      guessCompletedElapsedMs: [],
    };
  }

  const guesses =
    preset === "empty"
      ? []
      : preset === "first-guess"
        ? developmentGuesses().slice(0, 1)
        : developmentGuesses();
  const status =
    preset === "won" ? "won" : preset === "lost" ? "lost" : "playing";
  if (preset === "won") guesses.push(correctGuess());
  const maxGuesses = preset === "lost" ? guesses.length : 8;
  const ended = status !== "playing";
  const session: PublicGameSession = {
    id: `development-${mode}-${preset}`,
    mode,
    contentType: "character",
    status,
    maxGuesses,
    catalogVersion: CATALOG_VERSION,
    questionScope: developmentQuestionScope(maxGuesses),
    puzzleKey: "2099-09-09",
    guesses,
    startedAt: new Date(now.getTime() - 74_000).toISOString(),
    ...(ended ? { endedAt: now.toISOString(), answer: FLANDRE } : {}),
  };
  const guessCompletedElapsedMs = guesses.map(
    (_, index) =>
      [4_000, 13_000, 30_000, 51_000][index] ?? 51_000 + index * 8_000,
  );

  return {
    ...common,
    session,
    loading: false,
    message: "",
    initialElapsedMs: guesses.length === 0 ? 0 : 74_000,
    guessCompletedElapsedMs,
  };
}

export function buildMultiplayerGameSeed(
  preset: MultiplayerGameSeedPreset,
  now = new Date(),
): MultiplayerGameSeed {
  const mode: "race" | "relay" =
    preset.startsWith("relay") || preset === "lobby-relay" ? "relay" : "race";
  const role: "player" | "spectator" = preset.includes("spectator")
    ? "spectator"
    : "player";
  const nonHost = preset === "lobby-nonhost";
  const memberId =
    role === "spectator"
      ? SPECTATOR_MEMBER_ID
      : nonHost
        ? OPPONENT_MEMBER_ID
        : SELF_MEMBER_ID;
  const mySlot = nonHost ? (2 as const) : (1 as const);
  const placement = isPlacementPreset(preset);
  const lobby = preset.startsWith("lobby-");
  const finished = isFinishedPreset(preset);
  let members = developmentMembers(placement ? 4 : 2);

  if (preset === "lobby-alone" || preset === "lobby-spectator-open") {
    members = members.slice(0, 1);
  }
  if (preset === "lobby-self-ready") {
    members = members.map((member) => ({
      ...member,
      ready: member.memberId === SELF_MEMBER_ID,
    }));
  } else if (preset === "lobby-ready") {
    members = members.map((member) => ({ ...member, ready: true }));
  }
  if (preset === "reconnecting") {
    members = members.map((member) =>
      member.memberId === OPPONENT_MEMBER_ID
        ? { ...member, status: "disconnected" as const }
        : member,
    );
  }

  const playerLimit = placement ? 4 : 2;
  const room =
    preset === "syncing-spectator"
      ? null
      : {
          roomId: "development-room",
          roomCode: MULTIPLAYER_DEVELOPMENT_ROOM_CODE,
          format: "bo3" as const,
          mode,
          turnSeconds: 60,
          playerLimit,
          raceEliminationEnabled: placement,
          relayEliminationEnabled: mode === "relay" && placement,
          minPlayers: 2 as const,
          playerCount: members.length,
          availableSeats: Math.max(0, playerLimit - members.length),
          status: lobby
            ? ("lobby" as const)
            : finished
              ? ("finished" as const)
              : ("playing" as const),
          expiresAt: isoFrom(now, 30 * 60_000),
          spectatorCount: role === "spectator" ? 1 : 0,
        };
  const viewer =
    preset === "syncing-identity" || preset === "syncing-spectator"
      ? null
      : {
          memberId,
          role,
          ...(role === "player" ? { seat: mySlot } : {}),
          displayName:
            role === "spectator"
              ? "调试观战者"
              : (members.find((member) => member.memberId === memberId)
                  ?.displayName ?? "调试玩家"),
          status:
            preset === "viewer-disconnected"
              ? ("disconnected" as const)
              : ("connected" as const),
        };
  const reconnecting =
    preset === "reconnecting" || preset === "viewer-disconnected";
  const syncing = preset.startsWith("syncing-");
  const state: RoomUiState = {
    connection: syncing
      ? "connecting"
      : reconnecting
        ? "reconnecting"
        : "connected",
    connectionIssue:
      preset === "tab-conflict"
        ? "其他页面已连接此房间，当前页面已暂停实时同步。"
        : reconnecting
          ? "实时同步连接中断，正在自动恢复。"
          : null,
    room,
    viewer,
    members,
    relay: null,
    match: null,
    round: null,
    catalogVersion: lobby ? null : CATALOG_VERSION,
    questionScope: developmentQuestionScope(8),
    roundResult: null,
    matchResult: null,
    rematchReady: [],
    history: [],
    roundArchives: [],
    appliedGameSequence: 42,
    chat:
      role === "spectator"
        ? developmentSpectatorChat(now)
        : developmentChat(now),
  };

  if (room && !lobby && preset !== "syncing-room") {
    state.match = placement ? placementMatch(members) : standardMatch(members);
    state.history = [{ roundIndex: 1, result: "win" }];
    state.round =
      mode === "relay" ? relayRound(now, "playing") : raceRound(now, "playing");
  }

  switch (preset) {
    case "race-countdown":
      state.round = raceRound(now, "countdown");
      break;
    case "race-between-rounds":
    case "relay-between-rounds":
      state.round = null;
      break;
    case "race-empty":
      state.round = raceRound(now, "playing");
      state.round.self.guesses = [];
      state.round.opponents = state.round.opponents.map((opponent) => ({
        ...opponent,
        rows: [],
      }));
      break;
    case "race-correct":
      if (state.round) {
        state.round.self.participationStatus = "correct";
        state.round.self.guesses = [
          ...state.round.self.guesses,
          correctGuess(),
        ];
      }
      break;
    case "race-forfeited":
      if (state.round) state.round.self.participationStatus = "forfeited";
      break;
    case "race-exhausted":
      if (state.round) {
        state.round.self.participationStatus = "exhausted";
        state.round.self.guesses = exhaustedGuesses();
      }
      break;
    case "race-timed-out":
      if (state.round) state.round.self.participationStatus = "timed_out";
      break;
    case "race-n-player":
      applyPlacementPlayingState(state, now, false);
      break;
    case "race-round-result":
      applyRoundResultState(state, now, "race", "win");
      break;
    case "race-round-loss":
      applyRoundResultState(state, now, "race", "loss");
      break;
    case "race-round-draw":
      applyRoundResultState(state, now, "race", "draw");
      break;
    case "race-placement-result":
      applyPlacementResultState(state, now);
      break;
    case "race-final-round-result": {
      applyRoundResultState(state, now, "race", "win");
      if (state.room) state.room.status = "finished";
      const finalResult = twoPlayerMatchResult(now, "win");
      state.matchResult = finalResult;
      if (state.roundResult) {
        state.roundResult.scores = finalResult.scores;
        state.roundResult.results = finalResult.results;
        state.roundResult.nextStartsAt = undefined;
      }
      if (state.match) state.match.scores = finalResult.scores;
      break;
    }
    case "race-match-result":
      applyMatchResultState(state, now, "win");
      break;
    case "race-match-loss":
      applyMatchResultState(state, now, "loss");
      break;
    case "race-match-ranking":
      applyPlacementMatchResultState(state, now);
      break;
    case "race-spectator-playing":
      applyPlacementPlayingState(state, now, true);
      break;
    case "race-spectator-result":
      applyPlacementResultState(state, now);
      break;
    case "race-spectator-finished":
      applyPlacementResultState(state, now);
      applyPlacementMatchResultState(state, now);
      break;
    case "race-eliminated":
      applyEliminatedState(state, now);
      break;
    case "relay-countdown":
      state.round = relayRound(now, "countdown");
      break;
    case "relay-opponent-turn":
      state.round = relayRound(now, "playing", 2);
      break;
    case "relay-no-skips":
      state.round = relayRoundWithoutSkips(now);
      break;
    case "relay-round-result":
      applyRoundResultState(state, now, "relay", "win");
      break;
    case "relay-round-loss":
      applyRoundResultState(state, now, "relay", "loss");
      break;
    case "relay-round-forfeit":
      applyRoundResultState(state, now, "relay", "loss", SELF_MEMBER_ID);
      break;
    case "relay-match-result":
      applyMatchResultState(state, now, "win");
      break;
    case "relay-spectator-playing":
      applyRelaySpectatorState(state, now, false);
      break;
    case "relay-spectator-result":
      applyRelaySpectatorState(state, now, true);
      break;
    case "chat-empty":
      state.chat = chatFixture(now, "empty");
      break;
    case "chat-loading":
      state.chat = chatFixture(now, "loading");
      break;
    case "chat-history-error":
      state.chat = chatFixture(now, "history-error");
      break;
    case "chat-history-more":
      state.chat = chatFixture(now, "history-more");
      break;
    case "chat-sending":
      state.chat = chatFixture(now, "sending");
      break;
    case "chat-send-failed":
      state.chat = chatFixture(now, "send-failed");
      break;
    default:
      break;
  }

  return {
    state,
    mySlot,
    memberId,
    role,
    guessError:
      preset === "guess-error"
        ? "调试种子：该角色已在本局猜过，请选择其他角色。"
        : "",
  };
}

type DevelopmentMember = RoomUiState["members"][number];
type DevelopmentOutcome = "win" | "loss" | "draw";

function isPlacementPreset(preset: MultiplayerGameSeedPreset): boolean {
  return (
    preset === "race-n-player" ||
    preset === "race-placement-result" ||
    preset === "race-match-ranking" ||
    preset === "race-spectator-playing" ||
    preset === "race-spectator-result" ||
    preset === "race-spectator-finished" ||
    preset === "race-eliminated"
  );
}

function isFinishedPreset(preset: MultiplayerGameSeedPreset): boolean {
  return (
    preset === "race-final-round-result" ||
    preset === "race-match-result" ||
    preset === "race-match-loss" ||
    preset === "race-match-ranking" ||
    preset === "race-spectator-finished" ||
    preset === "relay-match-result"
  );
}

function developmentMembers(count: 2 | 4): DevelopmentMember[] {
  return [
    {
      memberId: SELF_MEMBER_ID,
      seat: 1,
      displayName: "调试玩家",
      status: "connected" as const,
      ready: false,
    },
    {
      memberId: OPPONENT_MEMBER_ID,
      seat: 2,
      displayName: "雾之湖对手",
      status: "connected" as const,
      ready: false,
    },
    {
      memberId: THIRD_MEMBER_ID,
      seat: 3,
      displayName: "守矢神社选手",
      status: "connected" as const,
      ready: false,
    },
    {
      memberId: FOURTH_MEMBER_ID,
      seat: 4,
      displayName: "地灵殿选手",
      status: "connected" as const,
      ready: false,
    },
  ].slice(0, count);
}

function standardMatch(
  members: DevelopmentMember[],
): NonNullable<RoomUiState["match"]> {
  return {
    matchIndex: 0,
    scoringMode: "wins",
    rosterSize: members.length,
    targetWins: 2,
    ruleSetRef: { mode: "race", key: "wins", version: 1 },
    activeFields: CHARACTER_GUESS_FIELDS,
    scores: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      score: index === 0 ? 1 : 0,
      status: "active" as const,
      bestRoundScore: 0,
    })),
    roundIndex: 2,
    maxRounds: 9,
    rematchReady: members.map((member) => ({
      memberId: member.memberId,
      seat: member.seat,
      ready: false,
    })),
    catalogVersion: CATALOG_VERSION,
    questionScope: developmentQuestionScope(8),
  };
}

function placementMatch(
  members: DevelopmentMember[],
): NonNullable<RoomUiState["match"]> {
  const scores = [12, 9, 6, 3];
  return {
    matchIndex: 0,
    scoringMode: "placement",
    rosterSize: members.length,
    targetWins: 1,
    ruleSetRef: { mode: "race", key: "placement", version: 1 },
    activeFields: CHARACTER_GUESS_FIELDS,
    scores: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      score: scores[index] ?? 0,
      status: "active" as const,
      bestRoundScore: index === 0 ? 6 : Math.max(0, 5 - index),
    })),
    roundIndex: 4,
    maxRounds: members.length * 3,
    rematchReady: members.map((member) => ({
      memberId: member.memberId,
      seat: member.seat,
      ready: false,
    })),
    catalogVersion: CATALOG_VERSION,
    questionScope: developmentQuestionScope(8),
  };
}

function placementRound(
  now: Date,
  members: DevelopmentMember[],
  spectator: boolean,
): NonNullable<RoomUiState["round"]> {
  const boards = developmentBoards(members);
  return {
    status: "playing",
    startsAt: isoFrom(now, -12_000),
    deadline: isoFrom(now, 5 * 60_000),
    maxGuesses: 8,
    self: spectator
      ? { guesses: [] }
      : {
          memberId: SELF_MEMBER_ID,
          seat: 1,
          participationStatus: "active",
          guesses: developmentGuesses().slice(0, 2),
        },
    opponents: spectator
      ? []
      : members.slice(1).map((member, memberIndex) => ({
          memberId: member.memberId,
          seat: member.seat,
          fieldOrder: CHARACTER_GUESS_FIELDS.map((field) => field.key),
          rows: Array.from({ length: memberIndex + 1 }, (_, rowIndex) => ({
            index: rowIndex + 1,
            statuses: CHARACTER_GUESS_FIELDS.map(
              (_, fieldIndex) =>
                (
                  [
                    "miss",
                    "partial",
                    "higher",
                    "exact",
                    "unknown",
                    "lower",
                  ] as const
                )[(fieldIndex + memberIndex + rowIndex) % 6],
            ),
          })),
        })),
    ...(spectator ? { boards } : {}),
  };
}

function developmentBoards(
  members: DevelopmentMember[],
): NonNullable<NonNullable<RoomUiState["round"]>["boards"]> {
  const guesses = developmentGuesses();
  return members.map((member, index) => ({
    memberId: member.memberId,
    seat: member.seat,
    guesses:
      index === 0
        ? guesses.slice(0, 3)
        : index === 1
          ? guesses.slice(1, 3)
          : index === 2
            ? guesses.slice(0, 1)
            : [],
  }));
}

function applyPlacementPlayingState(
  state: RoomUiState,
  now: Date,
  spectator: boolean,
) {
  state.match = placementMatch(state.members);
  state.round = placementRound(now, state.members, spectator);
  state.catalogVersion = CATALOG_VERSION;
}

function applyRoundResultState(
  state: RoomUiState,
  now: Date,
  mode: "race" | "relay",
  outcome: DevelopmentOutcome,
  forfeitedMemberId?: string,
) {
  const result = roundResult(now, mode === "relay", outcome, forfeitedMemberId);
  state.round =
    mode === "relay" ? relayRound(now, "ended") : raceRound(now, "ended");
  state.roundResult = result;
  state.roundArchives = [result];
  state.history = [
    { roundIndex: 1, result: outcome === "win" ? "loss" : "win" },
    { roundIndex: result.roundIndex, result: outcome },
  ];
  if (state.match) {
    state.match.scores = result.scores;
    state.match.roundIndex = result.roundIndex;
  }
}

function placementRoundResult(
  now: Date,
  members: DevelopmentMember[],
): RoundEndedPayload {
  const points = [6, 4, 2, 0];
  const scores = members.map((member, index) => ({
    memberId: member.memberId,
    seat: member.seat,
    score: [18, 13, 8, 3][index] ?? 0,
    status: index === 3 ? ("eliminated" as const) : ("active" as const),
    bestRoundScore: points[index] ?? 0,
    ...(index === 3 ? { eliminatedRound: 4 } : {}),
  }));
  return {
    matchIndex: 0,
    roundIndex: 4,
    viewerResult: "win",
    winnerMemberId: SELF_MEMBER_ID,
    answer: developmentAnswer(),
    boards: developmentBoards(members),
    scores,
    results: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      result: index === 0 ? ("win" as const) : ("loss" as const),
    })),
    placements: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      status:
        index < 2
          ? ("correct" as const)
          : index === 2
            ? ("exhausted" as const)
            : ("forfeited" as const),
      ...(index < 2 ? { finishRank: index + 1 } : {}),
      pointsAwarded: points[index] ?? 0,
    })),
    eliminatedMemberIds: [FOURTH_MEMBER_ID],
    nextStartsAt: isoFrom(now, 60_000),
  };
}

function applyPlacementResultState(state: RoomUiState, now: Date) {
  const result = placementRoundResult(now, state.members);
  state.match = placementMatch(state.members);
  state.match.scores = result.scores;
  state.match.roundIndex = result.roundIndex;
  state.round = {
    ...placementRound(now, state.members, true),
    status: "ended",
  };
  state.roundResult = result;
  state.roundArchives = [result];
  state.history = [{ roundIndex: result.roundIndex, result: "win" }];
}

function twoPlayerMatchResult(
  now: Date,
  outcome: Exclude<DevelopmentOutcome, "draw">,
): NonNullable<RoomUiState["matchResult"]> {
  const won = outcome === "win";
  const scores = memberScores(won ? 2 : 1, won ? 1 : 2);
  return {
    matchIndex: 0,
    viewerResult: outcome,
    winnerMemberId: won ? SELF_MEMBER_ID : OPPONENT_MEMBER_ID,
    scores,
    results: memberResults(won ? "win" : "loss", won ? "loss" : "win"),
    reason: "normal",
    retentionEndsAt: isoFrom(now, 30 * 60_000),
  };
}

function applyMatchResultState(
  state: RoomUiState,
  now: Date,
  outcome: Exclude<DevelopmentOutcome, "draw">,
) {
  const result = twoPlayerMatchResult(now, outcome);
  if (state.room) state.room.status = "finished";
  state.round = null;
  state.roundResult = null;
  state.matchResult = result;
  state.rematchReady = memberReady(false, true);
  state.history = [
    { roundIndex: 1, result: outcome },
    { roundIndex: 2, result: outcome === "win" ? "loss" : "win" },
    { roundIndex: 3, result: outcome },
  ];
  if (state.match) {
    state.match.scores = result.scores;
    state.match.roundIndex = 3;
    state.match.rematchReady = state.rematchReady;
  }
}

function placementMatchResult(
  now: Date,
  members: DevelopmentMember[],
): NonNullable<RoomUiState["matchResult"]> {
  const scores = placementRoundResult(now, members).scores;
  return {
    matchIndex: 0,
    viewerResult: "win",
    winnerMemberId: SELF_MEMBER_ID,
    scores,
    results: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      result: index === 0 ? ("win" as const) : ("loss" as const),
    })),
    ranking: members.map((member, index) => ({
      memberId: member.memberId,
      seat: member.seat,
      rank: index + 1,
      score: scores[index]?.score ?? 0,
      status: scores[index]?.status ?? "active",
      ...(scores[index]?.eliminatedRound
        ? { eliminatedRound: scores[index].eliminatedRound }
        : {}),
    })),
    reason: "normal",
    retentionEndsAt: isoFrom(now, 30 * 60_000),
  };
}

function applyPlacementMatchResultState(state: RoomUiState, now: Date) {
  const result = placementMatchResult(now, state.members);
  if (state.room) state.room.status = "finished";
  state.match = placementMatch(state.members);
  state.match.scores = result.scores;
  state.round = null;
  state.matchResult = result;
  state.rematchReady = state.members.map((member, index) => ({
    memberId: member.memberId,
    seat: member.seat,
    ready: index === 1,
  }));
}

function applyEliminatedState(state: RoomUiState, now: Date) {
  applyPlacementPlayingState(state, now, true);
  if (!state.match) return;
  state.match.scores = state.match.scores.map((score) =>
    score.memberId === SELF_MEMBER_ID
      ? { ...score, status: "eliminated" as const, eliminatedRound: 3 }
      : score,
  );
}

function applyRelaySpectatorState(
  state: RoomUiState,
  now: Date,
  ended: boolean,
) {
  state.round = relayRound(now, ended ? "ended" : "playing", 2);
  if (ended) applyRoundResultState(state, now, "relay", "loss");
}

function exhaustedGuesses(): NormalizedGuessResult[] {
  const guesses = developmentGuesses();
  return Array.from({ length: 8 }, (_, index) => {
    const source = guesses[index % guesses.length];
    return { ...source, guessId: `${source.guessId}-${index + 1}` };
  });
}

function relayRoundWithoutSkips(now: Date): NonNullable<RoomUiState["round"]> {
  const round = relayRound(now, "playing", 1);
  round.shared?.rows.push({
    index: (round.shared?.rows.length ?? 0) + 1,
    memberId: SELF_MEMBER_ID,
    seat: 1,
    kind: "pass",
  });
  return round;
}

function chatFixture(
  now: Date,
  variant:
    | "empty"
    | "loading"
    | "history-error"
    | "history-more"
    | "sending"
    | "send-failed",
): RoomUiState["chat"] {
  if (variant === "empty") {
    return { ...initialRoomChatState, historyStatus: "ready" };
  }
  if (variant === "loading") {
    return { ...initialRoomChatState, historyStatus: "loading" };
  }
  if (variant === "history-error") {
    return {
      ...initialRoomChatState,
      historyStatus: "error",
      historyError: "调试种子：聊天记录加载失败。",
    };
  }
  const chat = developmentChat(now);
  if (variant === "history-more") {
    return {
      ...chat,
      beforeCursor: "development-chat-before",
      hasMoreOlder: true,
    };
  }
  const pending = {
    messageId: "pending:development-client-message",
    roomId: "development-room",
    senderMemberId: SELF_MEMBER_ID,
    senderDisplayName: "调试玩家",
    senderRole: "player" as const,
    senderSeat: 1,
    kind: "text" as const,
    content: "这是一条待发送的调试消息。",
    channel: "room" as const,
    createdAt: isoFrom(now, -2_000),
    deliveryStatus:
      variant === "sending" ? ("sending" as const) : ("failed" as const),
    clientMessageId: "development-client-message",
    ...(variant === "send-failed" ? { error: "调试种子：消息发送失败。" } : {}),
  };
  return {
    ...chat,
    messages: [...chat.messages, pending],
    ...(variant === "send-failed"
      ? { sendError: "调试种子：消息发送失败。" }
      : {}),
  };
}

function developmentAnswer(): RoundEndedPayload["answer"] {
  return {
    id: FLANDRE.id,
    name: FLANDRE.names.zhHans,
    avatarUrl: FLANDRE.avatarUrl,
    workId: FLANDRE.firstAppearance.workId,
    workTitle: FLANDRE.firstAppearance.workTitle,
    workCode: "TH06",
  };
}

function isSingleGameSeedPreset(value: string): value is SingleGameSeedPreset {
  return (SINGLE_GAME_SEED_PRESETS as readonly string[]).includes(value);
}

function isMultiplayerGameSeedPreset(
  value: string,
): value is MultiplayerGameSeedPreset {
  return (MULTIPLAYER_GAME_SEED_PRESETS as readonly string[]).includes(value);
}

function developmentQuestionScope(maxGuesses: number): QuestionScopeConfig {
  return {
    schemaVersion: QUESTION_SCOPE_SCHEMA_VERSION,
    catalogVersion: CATALOG_VERSION,
    mode: "custom",
    difficulty: "custom",
    selectedCharacterIds: [
      "reimu_hakurei",
      "marisa_kirisame",
      "cirno",
      "flandre_scarlet",
    ],
    workStates: [],
    rules: {
      fieldModes: {
        firstAppearance: "default",
        releaseYear: "directional",
        species: "default",
        affiliations: "default",
        locations: "default",
        hairColors: "default",
      },
      fields: {
        firstAppearance: true,
        releaseYear: "directional",
        species: true,
        affiliations: true,
        locations: true,
        hairColors: true,
      },
      turnLimit: { enabled: true, seconds: 120 },
      guessLimit: { enabled: true, maxGuesses },
    },
  };
}

function developmentGuesses(): NormalizedGuessResult[] {
  return [
    guess("reimu_hakurei", "博丽灵梦", "/characters/0001-博丽灵梦.png", [
      "exact",
      "higher",
      "partial",
      "miss",
      "unknown",
      "lower",
    ]),
    {
      kind: "timeout",
      guessId: "development-timeout-1",
      guessName: "超时空过",
      isCorrect: false,
      matchKind: "none",
      feedback: [],
    },
    guess("marisa_kirisame", "雾雨魔理沙", "/characters/0002-雾雨魔理沙.png", [
      "partial",
      "lower",
      "miss",
      "exact",
      "partial",
      "miss",
    ]),
    guess("cirno", "琪露诺", "/characters/0603-琪露诺.png", [
      "exact",
      "higher",
      "partial",
      "miss",
      "exact",
      "partial",
    ]),
  ];
}

function correctGuess(): NormalizedGuessResult {
  return guess(
    "flandre_scarlet",
    "芙兰朵露·斯卡蕾特",
    "/characters/0609-芙兰朵露.png",
    CHARACTER_GUESS_FIELDS.map(() => "exact"),
    true,
  );
}

function guess(
  guessId: string,
  guessName: string,
  guessAvatarUrl: string,
  statuses: FeedbackStatus[],
  isCorrect = false,
): NormalizedGuessResult {
  return {
    kind: "guess",
    guessId,
    guessName,
    guessAvatarUrl,
    isCorrect,
    matchKind: isCorrect ? "exact" : "none",
    feedback: CHARACTER_GUESS_FIELDS.map((field, index) =>
      feedback(field.key, field.label, statuses[index] ?? "unknown", index),
    ),
  };
}

function feedback(
  field: FieldFeedback["field"],
  label: string,
  status: FeedbackStatus,
  index: number,
): FieldFeedback {
  const symbols: Record<FeedbackStatus, FieldFeedback["symbol"]> = {
    exact: "O",
    partial: "~",
    miss: "X",
    higher: "↑",
    lower: "↓",
    unknown: "?",
  };
  const values = [
    ["东方红魔乡"],
    ["2002"],
    ["妖怪", "人类"],
    ["红魔馆"],
    ["幻想乡", "雾之湖"],
    ["红", "金"],
  ];
  return {
    field,
    label,
    status,
    symbol: symbols[status],
    displayValue: values[index] ?? ["调试值"],
  };
}

function raceRound(
  now: Date,
  status: "countdown" | "playing" | "ended",
): NonNullable<RoomUiState["round"]> {
  const countdown = status === "countdown";
  return {
    status,
    startsAt: isoFrom(now, countdown ? 30_000 : -8_000),
    deadline: isoFrom(now, 8 * 60_000),
    maxGuesses: 8,
    self: {
      memberId: SELF_MEMBER_ID,
      seat: 1,
      participationStatus: "active",
      guesses: countdown ? [] : developmentGuesses().slice(0, 3),
    },
    opponents: [
      {
        memberId: OPPONENT_MEMBER_ID,
        seat: 2,
        fieldOrder: CHARACTER_GUESS_FIELDS.map((field) => field.key),
        rows: countdown
          ? []
          : [
              {
                index: 1,
                statuses: [
                  "miss",
                  "higher",
                  "partial",
                  "exact",
                  "unknown",
                  "lower",
                ],
              },
              {
                index: 2,
                statuses: [
                  "partial",
                  "lower",
                  "miss",
                  "partial",
                  "exact",
                  "miss",
                ],
              },
            ],
      },
    ],
  };
}

function relayRound(
  now: Date,
  status: "countdown" | "playing" | "ended",
  activeTurnSeat: 1 | 2 = 1,
): NonNullable<RoomUiState["round"]> {
  const countdown = status === "countdown";
  const rows = countdown
    ? []
    : [
        {
          index: 1,
          memberId: SELF_MEMBER_ID,
          seat: 1,
          kind: "guess" as const,
          guess: developmentGuesses()[0],
        },
        {
          index: 2,
          memberId: OPPONENT_MEMBER_ID,
          seat: 2,
          kind: "pass" as const,
        },
        {
          index: 3,
          memberId: SELF_MEMBER_ID,
          seat: 1,
          kind: "timeout" as const,
        },
        {
          index: 4,
          memberId: OPPONENT_MEMBER_ID,
          seat: 2,
          kind: "guess" as const,
          guess: developmentGuesses()[2],
        },
      ];
  const activeMemberId =
    activeTurnSeat === 1 ? SELF_MEMBER_ID : OPPONENT_MEMBER_ID;
  return {
    status,
    startsAt: isoFrom(now, countdown ? 30_000 : -8_000),
    deadline: isoFrom(now, 8 * 60_000),
    maxGuesses: 8,
    self: {
      memberId: SELF_MEMBER_ID,
      seat: 1,
      participationStatus: "active",
      guesses: [],
    },
    opponents: [],
    shared: { rows },
    turnMemberId: status === "playing" ? activeMemberId : undefined,
    turnSeat: status === "playing" ? activeTurnSeat : undefined,
    turnDeadline: status === "playing" ? isoFrom(now, 50_000) : undefined,
    maxTurnsPerPlayer: 8,
    maxSkipsPerPlayer: 2,
  };
}

function roundResult(
  now: Date,
  relay: boolean,
  outcome: DevelopmentOutcome = "win",
  forfeitedMemberId?: string,
): RoundEndedPayload {
  const winnerMemberId =
    outcome === "win"
      ? SELF_MEMBER_ID
      : outcome === "loss"
        ? OPPONENT_MEMBER_ID
        : null;
  const selfGuesses = [
    ...developmentGuesses().slice(0, 2),
    ...(outcome === "win" ? [correctGuess()] : []),
  ];
  const opponentGuesses = [
    ...developmentGuesses().slice(2),
    ...(outcome === "loss" ? [correctGuess()] : []),
  ];
  const turns = relay ? [...(relayRound(now, "ended").shared?.rows ?? [])] : [];
  if (relay && winnerMemberId) {
    turns.push({
      index: turns.length + 1,
      memberId: winnerMemberId,
      seat: winnerMemberId === SELF_MEMBER_ID ? 1 : 2,
      kind: "guess",
      guess: correctGuess(),
    });
  }
  return {
    matchIndex: 0,
    roundIndex: 2,
    viewerResult: outcome,
    winnerMemberId,
    ...(forfeitedMemberId ? { forfeitedMemberId } : {}),
    answer: developmentAnswer(),
    boards: [
      { memberId: SELF_MEMBER_ID, seat: 1, guesses: selfGuesses },
      { memberId: OPPONENT_MEMBER_ID, seat: 2, guesses: opponentGuesses },
    ],
    ...(relay ? { turns } : {}),
    scores: memberScores(1, 1),
    results: memberResults(
      outcome,
      outcome === "win" ? "loss" : outcome === "loss" ? "win" : "draw",
    ),
    nextStartsAt: isoFrom(now, 60_000),
  };
}

function memberScores(
  selfScore: number,
  opponentScore: number,
): NonNullable<RoomUiState["match"]>["scores"] {
  return [
    {
      memberId: SELF_MEMBER_ID,
      seat: 1,
      score: selfScore,
      status: "active",
      bestRoundScore: 0,
    },
    {
      memberId: OPPONENT_MEMBER_ID,
      seat: 2,
      score: opponentScore,
      status: "active",
      bestRoundScore: 0,
    },
  ];
}

function memberReady(
  selfReady: boolean,
  opponentReady: boolean,
): RoomUiState["rematchReady"] {
  return [
    { memberId: SELF_MEMBER_ID, seat: 1, ready: selfReady },
    { memberId: OPPONENT_MEMBER_ID, seat: 2, ready: opponentReady },
  ];
}

function memberResults(
  selfResult: "win" | "loss" | "draw",
  opponentResult: "win" | "loss" | "draw",
): RoundEndedPayload["results"] {
  return [
    { memberId: SELF_MEMBER_ID, seat: 1, result: selfResult },
    { memberId: OPPONENT_MEMBER_ID, seat: 2, result: opponentResult },
  ];
}

function developmentChat(now: Date): RoomUiState["chat"] {
  return {
    ...initialRoomChatState,
    historyStatus: "ready",
    scannedCursor: "development-chat-2",
    messages: [
      {
        messageId: "development-chat-1",
        roomId: "development-room",
        senderMemberId: OPPONENT_MEMBER_ID,
        senderDisplayName: "雾之湖对手",
        senderRole: "player",
        senderSeat: 2,
        kind: "text",
        content: "这局从哪条线索开始？",
        channel: "room",
        cursor: "development-chat-1",
        createdAt: isoFrom(now, -20_000),
        deliveryStatus: "sent",
      },
      {
        messageId: "development-chat-2",
        roomId: "development-room",
        senderMemberId: SELF_MEMBER_ID,
        senderDisplayName: "调试玩家",
        senderRole: "player",
        senderSeat: 1,
        kind: "emoji",
        content: "🌸",
        channel: "room",
        cursor: "development-chat-2",
        createdAt: isoFrom(now, -8_000),
        deliveryStatus: "sent",
      },
    ],
  };
}

function developmentSpectatorChat(now: Date): RoomUiState["chat"] {
  const chat = developmentChat(now);
  return {
    ...chat,
    scannedCursor: "development-chat-3",
    messages: [
      ...chat.messages,
      {
        messageId: "development-chat-3",
        roomId: "development-room",
        senderMemberId: SPECTATOR_MEMBER_ID,
        senderDisplayName: "调试观战者",
        senderRole: "spectator",
        kind: "text",
        content: "观战席消息只对观战者显示。",
        channel: "spectator",
        cursor: "development-chat-3",
        createdAt: isoFrom(now, -4_000),
        deliveryStatus: "sent",
      },
    ],
  };
}

function isoFrom(now: Date, offsetMs: number): string {
  return new Date(now.getTime() + offsetMs).toISOString();
}

const FLANDRE: Character = {
  id: "flandre_scarlet",
  avatarUrl: "/characters/0609-芙兰朵露.png",
  appearanceOrder: 609,
  names: {
    zhHans: "芙兰朵露·斯卡蕾特",
    ja: "フランドール・スカーレット",
    en: "Flandre Scarlet",
    romaji: "Furandooru Sukaretto",
    aliases: ["芙兰", "二小姐", "妹样"],
  },
  firstAppearance: {
    workId: "th06_eosd",
    workTitle: "东方红魔乡",
    workType: "stg",
    releaseYear: 2002,
    mainlineIndex: 6,
    era: "windows",
  },
  species: ["吸血鬼"],
  abilityDisplay: "破坏一切事物的能力",
  abilityTags: ["破坏"],
  affiliations: ["红魔馆"],
  locations: ["红魔馆地下室"],
  roles: ["EX Boss"],
  hairColors: ["blonde"],
  playable: false,
  enabledAsAnswer: true,
  enabledAsGuess: true,
  difficultyTier: "normal",
  sourceRefs: ["development-seed"],
};
