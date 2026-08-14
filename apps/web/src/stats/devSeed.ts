import type { MultiRoomFormat, MultiplayerMode } from "@touhouflandre/shared";
import { replaceStatistics } from "./db";
import {
  STATS_SCHEMA_VERSION,
  type MultiplayerStatsRecord,
  type SingleStatsRecord,
  type StatsCharacterSnapshot,
  type StatsDifficulty,
  type StatsGuessSnapshot,
  type StatsRecord,
  type StatsRound,
} from "./types";

declare global {
  interface TouhouFlandreDevelopmentTools {
    seedStatistics?: () => Promise<number>;
  }
}

const SEED_CHARACTERS: StatsCharacterSnapshot[] = [
  {
    id: "reimu_hakurei",
    name: "博丽灵梦",
    avatarUrl: "/characters/0001-博丽灵梦.png",
    work: { id: "th01_hrtp", title: "东方灵异传", code: "TH01" },
  },
  {
    id: "marisa_kirisame",
    name: "雾雨魔理沙",
    avatarUrl: "/characters/0002-雾雨魔理沙.png",
    work: { id: "th02_soew", title: "东方封魔录", code: "TH02" },
  },
  {
    id: "cirno",
    name: "琪露诺",
    avatarUrl: "/characters/0603-琪露诺.png",
    work: { id: "th06_eosd", title: "东方红魔乡", code: "TH06" },
  },
  {
    id: "youmu_konpaku",
    name: "魂魄妖梦",
    avatarUrl: "/characters/0708-魂魄妖梦.png",
    work: { id: "th07_pcb", title: "东方妖妖梦", code: "TH07" },
  },
  {
    id: "reisen_udongein_inaba",
    name: "铃仙·优昙华院·因幡",
    work: { id: "th08_in", title: "东方永夜抄", code: "TH08" },
  },
  {
    id: "sanae_kochiya",
    name: "东风谷早苗",
    avatarUrl: "/characters/1006-东风谷早苗.png",
    work: { id: "th10_mof", title: "东方风神录", code: "TH10" },
  },
  {
    id: "flandre_scarlet",
    name: "芙兰朵露·斯卡蕾特",
    avatarUrl: "/characters/0609-芙兰朵露.png",
    work: { id: "th06_eosd", title: "东方红魔乡", code: "TH06" },
  },
];

const DIFFICULTIES: StatsDifficulty[] = [
  "easy",
  "normal",
  "hard",
  "lunatic",
  "custom",
];
const FORMATS: MultiRoomFormat[] = ["bo1", "bo3", "bo5", "bo7"];
const MULTIPLAYER_MODES: MultiplayerMode[] = ["race", "relay"];

export function buildStatisticsSeed(now = new Date()): StatsRecord[] {
  return [
    ...Array.from({ length: 24 }, (_, index) => buildSingleRecord(index, now)),
    ...Array.from({ length: 6 }, (_, index) =>
      buildMultiplayerRecord(index, now),
    ),
  ];
}

export async function seedStatistics(): Promise<number> {
  const records = buildStatisticsSeed();
  await replaceStatistics(records);
  return records.length;
}

export function installStatisticsDevelopmentTools(): () => void {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") {
    return () => undefined;
  }

  const tools = (window.__touhouflandreDev ??= {});
  tools.seedStatistics = seedStatistics;

  return () => {
    if (tools.seedStatistics === seedStatistics) delete tools.seedStatistics;
    if (Object.keys(tools).length === 0) delete window.__touhouflandreDev;
  };
}

function buildSingleRecord(index: number, now: Date): SingleStatsRecord {
  const streakRecord = index < 5;
  const started = seededDate(now, index, 19 + (index % 3));
  const answer = SEED_CHARACTERS[index % SEED_CHARACTERS.length];
  const mode = streakRecord || index % 3 !== 0 ? "daily" : "random";
  const difficulty = streakRecord
    ? "normal"
    : DIFFICULTIES[index % DIFFICULTIES.length];
  const won = streakRecord || index % 5 !== 4;
  const guessCount = won ? 1 + (index % 6) : 6 + (index % 3);
  const round = buildSingleRound(index, started, answer, guessCount, won);

  return {
    id: `debug-single-${String(index + 1).padStart(2, "0")}`,
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "single",
    mode,
    difficulty,
    puzzleKey: mode === "daily" ? localDateKey(started) : undefined,
    startedAt: started.toISOString(),
    endedAt: round.endedAt,
    durationMs: round.durationMs,
    outcome: won ? "win" : "loss",
    round,
  };
}

function buildSingleRound(
  index: number,
  started: Date,
  answer: StatsCharacterSnapshot,
  guessCount: number,
  won: boolean,
): StatsRound {
  const guesses = buildGuesses(index, answer, guessCount, won);
  const durationMs =
    guesses.reduce((sum, guess) => sum + (guess.durationMs ?? 0), 0) +
    8_000 +
    index * 700;
  return {
    roundIndex: 1,
    startedAt: started.toISOString(),
    endedAt: new Date(started.getTime() + durationMs).toISOString(),
    durationMs,
    result: won ? "win" : "loss",
    answer,
    guesses,
  };
}

function buildGuesses(
  seed: number,
  answer: StatsCharacterSnapshot,
  count: number,
  won: boolean,
): StatsGuessSnapshot[] {
  return Array.from({ length: count }, (_, index) => {
    const correct = won && index === count - 1;
    const fallback =
      SEED_CHARACTERS[(seed + index + 1) % SEED_CHARACTERS.length];
    const character = correct
      ? answer
      : fallback.id === answer.id
        ? SEED_CHARACTERS[(seed + index + 2) % SEED_CHARACTERS.length]
        : fallback;
    return {
      ...character,
      correct,
      durationMs: 4_500 + ((seed * 1_700 + index * 2_300) % 26_000),
    };
  });
}

function buildMultiplayerRecord(
  index: number,
  now: Date,
): MultiplayerStatsRecord {
  const started = seededDate(now, index + 2, 14 + index);
  const multiplayerMode = MULTIPLAYER_MODES[index % MULTIPLAYER_MODES.length];
  const outcome = index % 3 === 0 ? "win" : index % 3 === 1 ? "loss" : "draw";
  const results: StatsRound["result"][] =
    outcome === "win"
      ? ["win", "loss", "win"]
      : outcome === "loss"
        ? ["loss", "win", "loss"]
        : ["win", "loss", "draw"];
  const rounds = results.map((result, roundIndex) =>
    buildMultiplayerRound(
      index,
      roundIndex + 1,
      started,
      multiplayerMode,
      result,
    ),
  );
  const wins = rounds.filter((round) => round.result === "win").length;
  const losses = rounds.filter((round) => round.result === "loss").length;
  const endedAt = rounds[rounds.length - 1].endedAt;

  return {
    id: `debug-multiplayer-${String(index + 1).padStart(2, "0")}`,
    schemaVersion: STATS_SCHEMA_VERSION,
    kind: "multiplayer",
    mode: "multiplayer",
    difficulty: DIFFICULTIES[(index + 1) % DIFFICULTIES.length],
    format: FORMATS[index % FORMATS.length],
    multiplayerMode,
    memberSlot: 1,
    matchIndex: index + 1,
    reason: "normal",
    scoreSelf: wins,
    scoreOpponent: losses,
    startedAt: started.toISOString(),
    endedAt,
    durationMs: rounds.reduce((sum, round) => sum + round.durationMs, 0),
    outcome,
    rounds,
  };
}

function buildMultiplayerRound(
  matchIndex: number,
  roundIndex: number,
  matchStarted: Date,
  mode: MultiplayerMode,
  result: StatsRound["result"],
): StatsRound {
  const started = new Date(matchStarted.getTime() + (roundIndex - 1) * 150_000);
  const answer =
    SEED_CHARACTERS[(matchIndex + roundIndex + 2) % SEED_CHARACTERS.length];
  const guessCount = 3 + ((matchIndex + roundIndex) % 5);
  const winningSlot = result === "win" ? 1 : result === "loss" ? 2 : undefined;
  const guesses = Array.from({ length: guessCount }, (_, index) => {
    const memberSlot = ((index % 2) + 1) as 1 | 2;
    const correct = winningSlot !== undefined && index === guessCount - 1;
    const character = correct
      ? answer
      : SEED_CHARACTERS[
          (matchIndex + roundIndex + index) % SEED_CHARACTERS.length
        ];
    return {
      ...character,
      correct,
      memberSlot: mode === "relay" ? memberSlot : undefined,
      durationMs: 5_000 + ((matchIndex * 2_100 + index * 3_100) % 24_000),
    } satisfies StatsGuessSnapshot;
  });
  if (winningSlot !== undefined && guesses.length) {
    guesses[guesses.length - 1].memberSlot =
      mode === "relay" ? winningSlot : undefined;
  }
  const durationMs =
    guesses.reduce((sum, guess) => sum + (guess.durationMs ?? 0), 0) + 12_000;

  return {
    roundIndex,
    startedAt: started.toISOString(),
    endedAt: new Date(started.getTime() + durationMs).toISOString(),
    durationMs,
    result,
    answer,
    guesses,
  };
}

function seededDate(now: Date, daysAgo: number, hour: number): Date {
  const value = new Date(now);
  value.setHours(hour, (daysAgo * 7) % 60, 0, 0);
  value.setDate(value.getDate() - daysAgo);
  return value;
}

function localDateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
