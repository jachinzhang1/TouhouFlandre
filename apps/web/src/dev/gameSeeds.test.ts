import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMultiplayerGameSeed,
  buildSingleGameSeed,
  clearMultiplayerGameSeed,
  loadMultiplayerGameSeed,
  MULTIPLAYER_GAME_SEED_PRESETS,
  parseMultiplayerGameSeedPreset,
  parseSingleGameSeedPreset,
  SINGLE_GAME_SEED_PRESETS,
  storeMultiplayerGameSeed,
} from "./gameSeeds";

const NOW = new Date("2026-08-14T12:00:00.000Z");

describe("singleplayer game UI seeds", () => {
  it("builds every advertised preset", () => {
    for (const preset of SINGLE_GAME_SEED_PRESETS) {
      expect(() => buildSingleGameSeed(preset, "random", NOW)).not.toThrow();
    }
  });

  it("fills the playing board with every feedback state and a timeout row", () => {
    const seed = buildSingleGameSeed("playing", "random", NOW);
    const statuses = new Set(
      seed.session?.guesses.flatMap((guess) =>
        guess.feedback.map((entry) => entry.status),
      ),
    );

    expect(statuses).toEqual(
      new Set(["exact", "partial", "miss", "higher", "lower", "unknown"]),
    );
    expect(
      seed.session?.guesses.some((guess) => guess.kind === "timeout"),
    ).toBe(true);
    expect(seed.session?.questionScope?.rules.turnLimit.enabled).toBe(true);
  });

  it("exposes loading, error, win, and loss branches", () => {
    expect(buildSingleGameSeed("loading", "daily", NOW).loading).toBe(true);
    expect(buildSingleGameSeed("error", "daily", NOW).message).toContain(
      "加载失败",
    );

    const won = buildSingleGameSeed("won", "daily", NOW).session;
    expect(won?.status).toBe("won");
    expect(won?.answer?.id).toBe("flandre_scarlet");
    expect(won?.guesses.at(-1)?.isCorrect).toBe(true);

    const lost = buildSingleGameSeed("lost", "random", NOW).session;
    expect(lost?.status).toBe("lost");
    expect(lost?.guesses).toHaveLength(lost?.maxGuesses ?? 0);
  });

  it("rejects unknown console preset names", () => {
    expect(parseSingleGameSeedPreset(undefined)).toBe("playing");
    expect(() => parseSingleGameSeedPreset("missing")).toThrow(
      SINGLE_GAME_SEED_PRESETS.join(", "),
    );
  });
});

describe("multiplayer game UI seeds", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds every advertised preset", () => {
    for (const preset of MULTIPLAYER_GAME_SEED_PRESETS) {
      const seed = buildMultiplayerGameSeed(preset, NOW);
      expect(seed.state.room).not.toBeNull();
    }
  });

  it("covers lobby, countdown, race, relay, results, and connection notices", () => {
    expect(
      buildMultiplayerGameSeed("lobby-alone", NOW).state.members,
    ).toHaveLength(1);
    expect(
      buildMultiplayerGameSeed("lobby-ready", NOW).state.members.every(
        (member) => member.ready,
      ),
    ).toBe(true);
    expect(
      buildMultiplayerGameSeed("race-countdown", NOW).state.round?.status,
    ).toBe("countdown");
    expect(
      buildMultiplayerGameSeed("race-playing", NOW).state.round?.opponent.rows,
    ).not.toHaveLength(0);

    const relay = buildMultiplayerGameSeed("relay-playing", NOW).state.round;
    expect(relay?.shared?.rows.map((row) => row.kind)).toEqual([
      "guess",
      "pass",
      "timeout",
      "guess",
    ]);
    expect(relay?.turnSlot).toBe(1);

    expect(
      buildMultiplayerGameSeed("race-round-result", NOW).state.roundResult,
    ).not.toBeNull();
    expect(
      buildMultiplayerGameSeed("relay-round-result", NOW).state.roundResult
        ?.turns,
    ).not.toHaveLength(0);
    expect(
      buildMultiplayerGameSeed("race-match-result", NOW).state.matchResult
        ?.result,
    ).toBe("win");
    expect(
      buildMultiplayerGameSeed("reconnecting", NOW).state.connectionIssue,
    ).not.toBeNull();
    expect(buildMultiplayerGameSeed("guess-error", NOW).guessError).not.toBe(
      "",
    );
  });

  it("persists the selected room fixture across navigation", () => {
    storeMultiplayerGameSeed("relay-playing");
    expect(loadMultiplayerGameSeed()).toBe("relay-playing");
    clearMultiplayerGameSeed();
    expect(loadMultiplayerGameSeed()).toBeNull();
  });

  it("rejects unknown console preset names", () => {
    expect(parseMultiplayerGameSeedPreset(undefined)).toBe("race-playing");
    expect(() => parseMultiplayerGameSeedPreset("missing")).toThrow(
      MULTIPLAYER_GAME_SEED_PRESETS.join(", "),
    );
  });
});
