import type { CatalogSearchIndex } from "@touhouflandre/shared";
import { describe, expect, it, vi } from "vitest";
import { CharacterSearchRouter } from "./router";

const index: CatalogSearchIndex = {
  catalogVersion: "catalog-v1",
  indexSchemaVersion: 1,
  entries: [
    {
      id: "reimu",
      name: "博丽灵梦",
      subtitle: "Reimu",
      initials: "博丽",
      avatarUrl: "",
      appearanceOrder: 1,
      workId: "th06_eosd",
      firstAppearance: { workTitle: "红魔乡", releaseYear: 2002 },
      species: [],
      locations: [],
      affiliations: [],
      hairColors: [],
      searchTerms: ["博丽灵梦", "reimu"],
      nameSortKey: "reimu",
    },
    {
      id: "marisa",
      name: "雾雨魔理沙",
      subtitle: "Marisa",
      initials: "雾雨",
      avatarUrl: "",
      appearanceOrder: 2,
      workId: "th06_eosd",
      firstAppearance: { workTitle: "红魔乡", releaseYear: 2002 },
      species: [],
      locations: [],
      affiliations: [],
      hairColors: [],
      searchTerms: ["雾雨魔理沙", "marisa"],
      nameSortKey: "marisa",
    },
  ],
};

const localPolicy = {
  mode: "local-primary" as const,
  indexSchemaVersion: 1,
  revision: "hso007",
  gameScopeMode: "strict" as const,
  revalidateAfterSeconds: 60,
};

describe("HSO-007 assembled search contexts", () => {
  it.each([
    ["catalog", { contextKind: "catalog" as const }],
    [
      "single",
      {
        contextKind: "single-session" as const,
        sessionId: "session-1",
        selectedCharacterIds: ["reimu"],
      },
    ],
    [
      "race",
      {
        contextKind: "multiplayer-match" as const,
        roomId: "room-1",
        matchIndex: 1,
        selectedCharacterIds: ["reimu"],
      },
    ],
    [
      "relay",
      {
        contextKind: "multiplayer-match" as const,
        roomId: "room-1",
        matchIndex: 1,
        selectedCharacterIds: ["reimu"],
      },
    ],
  ])(
    "keeps %s on the same local engine and scope contract",
    async (_name, context) => {
      const remote = vi.fn();
      const router = new CharacterSearchRouter({
        policyClient: { get: vi.fn().mockResolvedValue(localPolicy) },
        indexRepository: { load: vi.fn().mockResolvedValue(index) } as never,
        remoteSearch: { search: remote },
      });

      const result = await router.search(
        {
          q: "灵梦",
          catalogVersion: "catalog-v1",
          ...context,
        },
        new AbortController().signal,
      );

      expect(result.results.map((entry) => entry.id)).toEqual(["reimu"]);
      expect(result.total).toBe(1);
      expect(remote).not.toHaveBeenCalled();
      router.dispose();
    },
  );
});
