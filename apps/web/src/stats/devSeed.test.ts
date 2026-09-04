import { afterEach, describe, expect, it } from "vitest";
import { statsDb } from "./db";
import { buildStatisticsSeed, seedStatistics } from "./devSeed";

afterEach(async () => {
  await statsDb.records.clear();
  await statsDb.drafts.clear();
  await statsDb.metadata.clear();
});

describe("statistics development seed", () => {
  it("covers charts, outcomes, difficulties, and multiplayer variants", () => {
    const records = buildStatisticsSeed(new Date("2026-08-14T12:00:00Z"));
    const multiplayer = records.filter(
      (record) => record.kind === "multiplayer",
    );
    const works = new Set(
      records.flatMap((record) =>
        (record.kind === "single" ? [record.round] : record.rounds).map(
          (round) => round.answer.work?.id,
        ),
      ),
    );

    expect(records).toHaveLength(30);
    expect(new Set(records.map((record) => record.mode))).toEqual(
      new Set(["daily", "random", "multiplayer"]),
    );
    expect(new Set(records.map((record) => record.outcome))).toEqual(
      new Set(["win", "loss", "draw"]),
    );
    expect(
      new Set(records.map((record) => record.difficulty)).size,
    ).toBeGreaterThan(3);
    expect(works.size).toBeGreaterThan(4);
    expect(
      new Set(multiplayer.map((record) => record.multiplayerMode)),
    ).toEqual(new Set(["race", "relay"]));
  });

  it("replaces local statistics and returns the seeded record count", async () => {
    const count = await seedStatistics();
    expect(count).toBe(30);
    expect(await statsDb.records.count()).toBe(30);
  });
});
