import { beforeEach, describe, expect, it } from "vitest";
import {
  buildMultiplayerGameSeed,
  buildSingleGameSeed,
  installGameSeedConsole,
  clearMultiplayerGameSeed,
  loadMultiplayerGameSeed,
  MULTIPLAYER_GAME_SEED_PRESETS,
  parseMultiplayerGameSeedPreset,
  parseSingleGameResultSeed,
  parseSingleGameSeedPreset,
  SINGLE_GAME_RESULT_SEEDS,
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

  it("parses replayable singleplayer result seeds", () => {
    expect(parseSingleGameResultSeed(undefined)).toBe("won");
    expect(parseSingleGameResultSeed("lost")).toBe("lost");
    expect(() => parseSingleGameResultSeed("missing")).toThrow(
      SINGLE_GAME_RESULT_SEEDS.join(", "),
    );
  });
});

describe("multiplayer game UI seeds", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("builds every unique advertised preset", () => {
    expect(new Set(MULTIPLAYER_GAME_SEED_PRESETS).size).toBe(
      MULTIPLAYER_GAME_SEED_PRESETS.length,
    );
    expect(MULTIPLAYER_GAME_SEED_PRESETS.length).toBeGreaterThanOrEqual(50);
    for (const preset of MULTIPLAYER_GAME_SEED_PRESETS) {
      const seed = buildMultiplayerGameSeed(preset, NOW);
      expect(seed.state.room === null).toBe(preset === "syncing-spectator");
      expect(seed.memberId).not.toBe("");
      expect(["player", "spectator"]).toContain(seed.role);
    }
  });

  it("covers synchronization, reconnect, conflict, and command errors", () => {
    const identity = buildMultiplayerGameSeed("syncing-identity", NOW);
    expect(identity.state.room).not.toBeNull();
    expect(identity.state.viewer).toBeNull();
    expect(identity.state.connection).toBe("connecting");

    const spectator = buildMultiplayerGameSeed("syncing-spectator", NOW);
    expect(spectator.role).toBe("spectator");
    expect(spectator.state.room).toBeNull();
    expect(spectator.state.viewer).toBeNull();

    expect(
      buildMultiplayerGameSeed("syncing-room", NOW).state.match,
    ).toBeNull();
    expect(buildMultiplayerGameSeed("reconnecting", NOW).state.connection).toBe(
      "reconnecting",
    );
    expect(
      buildMultiplayerGameSeed("viewer-disconnected", NOW).state.viewer?.status,
    ).toBe("disconnected");
    expect(
      buildMultiplayerGameSeed("tab-conflict", NOW).state.connectionIssue,
    ).toMatch(/^其他页面已连接/);
    expect(buildMultiplayerGameSeed("guess-error", NOW).guessError).not.toBe(
      "",
    );
  });

  it("covers every lobby role, readiness, capacity, and mode treatment", () => {
    expect(
      buildMultiplayerGameSeed("lobby-alone", NOW).state.members,
    ).toHaveLength(1);
    expect(
      buildMultiplayerGameSeed("lobby-waiting", NOW).state.members.every(
        (member) => !member.ready,
      ),
    ).toBe(true);
    const selfReady = buildMultiplayerGameSeed("lobby-self-ready", NOW);
    expect(selfReady.state.members.map((member) => member.ready)).toEqual([
      true,
      false,
    ]);
    expect(
      buildMultiplayerGameSeed("lobby-ready", NOW).state.members.every(
        (member) => member.ready,
      ),
    ).toBe(true);
    const nonHost = buildMultiplayerGameSeed("lobby-nonhost", NOW);
    expect(nonHost.mySlot).toBe(2);
    expect(nonHost.memberId).toBe(nonHost.state.members[1]?.memberId);
    expect(buildMultiplayerGameSeed("lobby-relay", NOW).state.room?.mode).toBe(
      "relay",
    );
    const openSpectator = buildMultiplayerGameSeed("lobby-spectator-open", NOW);
    expect(openSpectator.role).toBe("spectator");
    expect(openSpectator.state.room?.availableSeats).toBe(1);
    expect(
      buildMultiplayerGameSeed("lobby-spectator-full", NOW).state.room
        ?.availableSeats,
    ).toBe(0);
  });

  it("covers race countdown, board, read-only, placement, and result states", () => {
    expect(
      buildMultiplayerGameSeed("race-countdown", NOW).state.round?.status,
    ).toBe("countdown");
    expect(
      buildMultiplayerGameSeed("race-between-rounds", NOW).state.round,
    ).toBeNull();
    expect(
      buildMultiplayerGameSeed("race-empty", NOW).state.round?.self.guesses,
    ).toHaveLength(0);
    expect(
      buildMultiplayerGameSeed("race-playing", NOW).state.round?.opponents[0]
        ?.rows,
    ).not.toHaveLength(0);
    for (const [preset, status] of [
      ["race-correct", "correct"],
      ["race-forfeited", "forfeited"],
      ["race-exhausted", "exhausted"],
      ["race-timed-out", "timed_out"],
    ] as const) {
      expect(
        buildMultiplayerGameSeed(preset, NOW).state.round?.self
          .participationStatus,
      ).toBe(status);
    }
    expect(
      buildMultiplayerGameSeed("race-exhausted", NOW).state.round?.self.guesses,
    ).toHaveLength(8);

    const placement = buildMultiplayerGameSeed("race-n-player", NOW).state;
    expect(placement.members).toHaveLength(4);
    expect(placement.match?.scoringMode).toBe("placement");
    expect(placement.round?.opponents).toHaveLength(3);

    expect(
      buildMultiplayerGameSeed("race-round-result", NOW).state.roundResult
        ?.viewerResult,
    ).toBe("win");
    expect(
      buildMultiplayerGameSeed("race-round-loss", NOW).state.roundResult
        ?.viewerResult,
    ).toBe("loss");
    expect(
      buildMultiplayerGameSeed("race-round-draw", NOW).state.roundResult
        ?.winnerMemberId,
    ).toBeNull();
    expect(
      buildMultiplayerGameSeed("race-placement-result", NOW).state.roundResult
        ?.eliminatedMemberIds,
    ).toHaveLength(1);
  });

  it("covers final, spectator, ranking, and eliminated race surfaces", () => {
    const finalRound = buildMultiplayerGameSeed(
      "race-final-round-result",
      NOW,
    ).state;
    expect(finalRound.room?.status).toBe("finished");
    expect(finalRound.roundResult).not.toBeNull();
    expect(finalRound.matchResult).not.toBeNull();

    expect(
      buildMultiplayerGameSeed("race-match-result", NOW).state.matchResult
        ?.viewerResult,
    ).toBe("win");
    expect(
      buildMultiplayerGameSeed("race-match-loss", NOW).state.matchResult
        ?.viewerResult,
    ).toBe("loss");
    expect(
      buildMultiplayerGameSeed("race-match-ranking", NOW).state.matchResult
        ?.ranking,
    ).toHaveLength(4);

    const liveSpectator = buildMultiplayerGameSeed(
      "race-spectator-playing",
      NOW,
    );
    expect(liveSpectator.role).toBe("spectator");
    expect(liveSpectator.state.round?.boards).toHaveLength(4);
    expect(
      liveSpectator.state.chat.messages.some(
        (message) => message.senderRole === "spectator",
      ),
    ).toBe(true);
    expect(
      buildMultiplayerGameSeed("race-spectator-result", NOW).state
        .roundArchives,
    ).toHaveLength(1);
    expect(
      buildMultiplayerGameSeed("race-spectator-finished", NOW).state.room
        ?.status,
    ).toBe("finished");
    expect(
      buildMultiplayerGameSeed("race-eliminated", NOW).state.match?.scores.find(
        (score) => score.memberId === "development-self",
      )?.status,
    ).toBe("eliminated");
  });

  it("covers relay turns, skip exhaustion, outcomes, and spectator views", () => {
    expect(
      buildMultiplayerGameSeed("relay-countdown", NOW).state.round?.status,
    ).toBe("countdown");
    expect(
      buildMultiplayerGameSeed("relay-between-rounds", NOW).state.round,
    ).toBeNull();
    const relay = buildMultiplayerGameSeed("relay-playing", NOW).state.round;
    expect(relay?.shared?.rows.map((row) => row.kind)).toEqual([
      "guess",
      "pass",
      "timeout",
      "guess",
    ]);
    expect(relay?.turnSeat).toBe(1);
    expect(
      buildMultiplayerGameSeed("relay-opponent-turn", NOW).state.round
        ?.turnSeat,
    ).toBe(2);
    const noSkips = buildMultiplayerGameSeed("relay-no-skips", NOW).state.round;
    expect(
      noSkips?.shared?.rows.filter(
        (row) => row.seat === 1 && row.kind !== "guess",
      ),
    ).toHaveLength(2);
    expect(
      buildMultiplayerGameSeed("relay-round-result", NOW).state.roundResult
        ?.turns,
    ).not.toHaveLength(0);
    expect(
      buildMultiplayerGameSeed("relay-round-loss", NOW).state.roundResult
        ?.viewerResult,
    ).toBe("loss");
    expect(
      buildMultiplayerGameSeed("relay-round-forfeit", NOW).state.roundResult
        ?.forfeitedMemberId,
    ).toBe("development-self");
    expect(
      buildMultiplayerGameSeed("relay-match-result", NOW).state.room?.status,
    ).toBe("finished");
    expect(buildMultiplayerGameSeed("relay-spectator-playing", NOW).role).toBe(
      "spectator",
    );
    expect(
      buildMultiplayerGameSeed("relay-spectator-result", NOW).state
        .roundArchives,
    ).toHaveLength(1);
  });

  it("covers every chat history and delivery state", () => {
    expect(
      buildMultiplayerGameSeed("chat-empty", NOW).state.chat.messages,
    ).toHaveLength(0);
    expect(
      buildMultiplayerGameSeed("chat-loading", NOW).state.chat.historyStatus,
    ).toBe("loading");
    expect(
      buildMultiplayerGameSeed("chat-history-error", NOW).state.chat
        .historyError,
    ).not.toBeNull();
    expect(
      buildMultiplayerGameSeed("chat-history-more", NOW).state.chat
        .hasMoreOlder,
    ).toBe(true);
    expect(
      buildMultiplayerGameSeed("chat-sending", NOW).state.chat.messages.at(-1)
        ?.deliveryStatus,
    ).toBe("sending");
    const failed = buildMultiplayerGameSeed("chat-send-failed", NOW).state.chat;
    expect(failed.messages.at(-1)?.deliveryStatus).toBe("failed");
    expect(failed.sendError).not.toBeNull();
  });

  it("restores the previous development console controller on cleanup", () => {
    const controller = {
      page: "multiplayer" as const,
      presets: MULTIPLAYER_GAME_SEED_PRESETS,
      seed: () => "race-playing",
      reset: () => undefined,
    };
    const cleanup = installGameSeedConsole(controller);
    expect(window.__touhouflandreDev?.game).toBe(controller);

    const nestedController = {
      ...controller,
      seed: () => "relay-playing",
    };
    const cleanupNested = installGameSeedConsole(nestedController);
    expect(window.__touhouflandreDev?.game).toBe(nestedController);
    cleanupNested();
    expect(window.__touhouflandreDev?.game).toBe(controller);

    cleanup();
    expect(window.__touhouflandreDev?.game).toBeUndefined();
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
