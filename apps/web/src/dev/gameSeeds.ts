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
  "lobby-alone",
  "lobby-ready",
  "race-countdown",
  "race-playing",
  "race-round-result",
  "race-match-result",
  "relay-playing",
  "relay-round-result",
  "reconnecting",
  "guess-error",
] as const;
export type MultiplayerGameSeedPreset =
  (typeof MULTIPLAYER_GAME_SEED_PRESETS)[number];

export const MULTIPLAYER_DEVELOPMENT_ROOM_CODE = "DEV222";
const MULTIPLAYER_SEED_STORAGE_KEY = "touhouflandre:dev:multiplayer-seed";
const CATALOG_VERSION = "development-game-seed";
const SELF_MEMBER_ID = "development-self";
const OPPONENT_MEMBER_ID = "development-opponent";

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
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return () => undefined;
  }

  const tools = (window.__touhouflandreDev ??= {});
  tools.game = controller;

  return () => {
    if (tools.game === controller) delete tools.game;
    if (Object.keys(tools).length === 0) delete window.__touhouflandreDev;
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
  const mySlot = 1 as const;
  const mode = preset.startsWith("relay") ? "relay" : "race";
  const roomStatus = preset.startsWith("lobby")
    ? "lobby"
    : preset === "race-match-result"
      ? "finished"
      : "playing";
  const members = [
    {
      memberId: SELF_MEMBER_ID,
      seat: 1,
      displayName: "调试玩家",
      status: "connected" as const,
      ready: preset === "lobby-ready",
    },
    {
      memberId: OPPONENT_MEMBER_ID,
      seat: 2,
      displayName: "雾之湖对手",
      status:
        preset === "reconnecting"
          ? ("disconnected" as const)
          : ("connected" as const),
      ready: preset === "lobby-ready",
    },
  ];
  const visibleMembers =
    preset === "lobby-alone" ? members.slice(0, 1) : members;
  const state: RoomUiState = {
    connection: preset === "reconnecting" ? "reconnecting" : "connected",
    connectionIssue:
      preset === "reconnecting" ? "实时同步连接中断，正在自动恢复。" : null,
    room: {
      roomId: "development-room",
      roomCode: MULTIPLAYER_DEVELOPMENT_ROOM_CODE,
      format: "bo3",
      mode,
      turnSeconds: 60,
      playerLimit: 2,
      minPlayers: 2,
      playerCount: visibleMembers.length,
      availableSeats: 2 - visibleMembers.length,
      status: roomStatus,
      expiresAt: isoFrom(now, 30 * 60_000),
      spectatorCount: 0,
    },
    viewer: {
      memberId: SELF_MEMBER_ID,
      role: "player",
      seat: 1,
      displayName: "调试玩家",
      status: "connected",
    },
    members: visibleMembers,
    match: null,
    round: null,
    catalogVersion: null,
    questionScope: developmentQuestionScope(8),
    roundResult: null,
    matchResult: null,
    rematchReady: [],
    history: [],
    roundArchives: [],
    appliedGameSequence: 42,
    chat: developmentChat(now),
  };

  if (roomStatus !== "lobby") {
    state.match = {
      matchIndex: 0,
      scoringMode: "wins",
      rosterSize: 2,
      targetWins: 2,
      scores: memberScores(1, 0),
      roundIndex: 2,
      maxRounds: 9,
      rematchReady: memberReady(false, false),
      catalogVersion: CATALOG_VERSION,
      questionScope: developmentQuestionScope(8),
    };
    state.history = [{ roundIndex: 1, result: "win" }];
  }

  if (preset === "race-countdown") {
    state.round = raceRound(now, "countdown");
  } else if (
    preset === "race-playing" ||
    preset === "reconnecting" ||
    preset === "guess-error"
  ) {
    state.round = raceRound(now, "playing");
  } else if (preset === "relay-playing") {
    state.round = relayRound(now, "playing");
  } else if (
    preset === "race-round-result" ||
    preset === "relay-round-result"
  ) {
    const relay = preset === "relay-round-result";
    const result = roundResult(now, relay);
    state.round = relay ? relayRound(now, "ended") : raceRound(now, "ended");
    state.roundResult = result;
    state.roundArchives = [result];
    state.history = [
      { roundIndex: 1, result: "loss" },
      { roundIndex: 2, result: "win" },
    ];
    if (state.match) state.match.scores = result.scores;
  } else if (preset === "race-match-result") {
    const scores = memberScores(2, 1);
    state.matchResult = {
      matchIndex: 0,
      viewerResult: "win",
      winnerMemberId: SELF_MEMBER_ID,
      scores,
      results: memberResults("win", "loss"),
      reason: "normal",
      retentionEndsAt: isoFrom(now, 30 * 60_000),
    };
    state.rematchReady = memberReady(false, true);
    state.history = [
      { roundIndex: 1, result: "win" },
      { roundIndex: 2, result: "loss" },
      { roundIndex: 3, result: "win" },
    ];
    if (state.match) {
      state.match.scores = scores;
      state.match.roundIndex = 3;
      state.match.rematchReady = memberReady(false, true);
    }
  }

  return {
    state,
    mySlot,
    guessError:
      preset === "guess-error"
        ? "调试种子：该角色已在本局猜过，请选择其他角色。"
        : "",
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
  status: "playing" | "ended",
): NonNullable<RoomUiState["round"]> {
  const rows = [
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
  return {
    status,
    startsAt: isoFrom(now, -8_000),
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
    turnMemberId: status === "playing" ? SELF_MEMBER_ID : undefined,
    turnSeat: status === "playing" ? 1 : undefined,
    turnDeadline: status === "playing" ? isoFrom(now, 50_000) : undefined,
    maxTurnsPerPlayer: 8,
    maxSkipsPerPlayer: 2,
  };
}

function roundResult(now: Date, relay: boolean): RoundEndedPayload {
  const selfGuesses = [...developmentGuesses().slice(0, 2), correctGuess()];
  const opponentGuesses = developmentGuesses().slice(2);
  return {
    matchIndex: 0,
    roundIndex: 2,
    viewerResult: "win",
    winnerMemberId: SELF_MEMBER_ID,
    answer: {
      id: FLANDRE.id,
      name: FLANDRE.names.zhHans,
      avatarUrl: FLANDRE.avatarUrl,
      workId: FLANDRE.firstAppearance.workId,
      workTitle: FLANDRE.firstAppearance.workTitle,
      workCode: "TH06",
    },
    boards: [
      { memberId: SELF_MEMBER_ID, seat: 1, guesses: selfGuesses },
      { memberId: OPPONENT_MEMBER_ID, seat: 2, guesses: opponentGuesses },
    ],
    ...(relay ? { turns: relayRound(now, "ended").shared?.rows } : {}),
    scores: memberScores(1, 1),
    results: memberResults("win", "loss"),
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
