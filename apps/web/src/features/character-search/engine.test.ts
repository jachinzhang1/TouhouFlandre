import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeSearchText, searchCharacters } from "./engine";
import type { CatalogSearchIndexEntry } from "@touhouflandre/shared";

const entry = (id: string, appearanceOrder: number, nameSortKey: string, terms: string[], workId = "th06_eosd"): CatalogSearchIndexEntry => ({
  id, name: id, subtitle: id, initials: id.slice(0, 2), avatarUrl: "", appearanceOrder, workId,
  firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 }, species: [], locations: [], affiliations: [], hairColors: [], searchTerms: terms, nameSortKey,
});

const entries = [
  entry("zeta", 2, "zeta", ["reimuhakurei", "th06"]),
  entry("alpha", 1, "alpha", ["marisakirisame", "th07"], "th07_pcb"),
  entry("beta", 1, "beta", ["秋姐妹"]),
];

const fixture = JSON.parse(readFileSync("../../docs/hybrid-search-optimization/fixtures/search-parity-v1.json", "utf8")) as {
  characters: Array<Record<string, any>>;
  cases: Array<Record<string, any>>;
};
const fixtureEntries = fixture.characters.filter((character) => character.enabledAsGuess).map((character) => {
  const names = character.names;
  const appearance = character.firstAppearance;
  const values = [names.zhHans, names.zhHant, names.ja, names.en, names.romaji, ...names.aliases, appearance.workTitle, appearance.workId, ...appearance.workPinyinInitials, appearance.mainlineIndex == null ? undefined : `TH${String(appearance.mainlineIndex).padStart(2, "0")}`];
  const terms = [...new Set(values.filter((value): value is string => typeof value === "string").map(normalizeSearchText).filter(Boolean))];
  return entry(character.id, character.appearanceOrder, normalizeSearchText(names.romaji ?? names.en), terms, appearance.workId);
});

describe("character search engine", () => {
  it("matches every HSO-001 golden sample", () => {
    for (const testCase of fixture.cases) {
      const result = searchCharacters({ entries: fixtureEntries }, {
        query: testCase.query,
        allowedIds: testCase.selectedCharacterIds === null ? undefined : testCase.selectedCharacterIds,
        workIds: testCase.workIds ?? undefined,
        sortBy: testCase.sortBy,
        direction: testCase.descending ? "desc" : "asc",
        offset: testCase.offset,
        limit: testCase.limit,
      });
      expect({ ids: result.results.map((item) => item.id), total: result.total }, testCase.name).toEqual(testCase.expected);
    }
  });

  it("matches Go normalization without crossing term boundaries", () => {
    expect(normalizeSearchText(" Ｒｅｉｍｕ・Hakurei ")).toBe("reimuhakurei");
    expect(searchCharacters({ entries }, { query: "Reimu-Hakurei" }).results.map((item) => item.id)).toEqual(["zeta"]);
    expect(searchCharacters({ entries }, { query: "reimuhakurei", workIds: ["th07_pcb"] }).total).toBe(0);
    expect(searchCharacters({ entries }, { query: "marisa秋" }).total).toBe(0);
  });

  it("filters before paging and fails closed for an empty scope", () => {
    expect(searchCharacters({ entries }, { allowedIds: [] })).toEqual({ results: [], total: 0 });
    expect(searchCharacters({ entries }, { allowedIds: ["alpha", "beta"], offset: 1, limit: 1 }).results.map((item) => item.id)).toEqual(["beta"]);
  });

  it("uses stable id tie-breaks in both directions", () => {
    const ascending = searchCharacters({ entries }, { sortBy: "appearance" }).results.map((item) => item.id);
    const descending = searchCharacters({ entries }, { sortBy: "appearance", direction: "desc" }).results.map((item) => item.id);
    expect(ascending).toEqual(["alpha", "beta", "zeta"]);
    expect(descending).toEqual(["zeta", "alpha", "beta"]);
  });

  it("keeps fixed production-scale synchronous search under the 16ms p95 budget", () => {
    const scaled = Array.from({ length: 8 }, (_, copy) => fixtureEntries.map((item) => ({ ...item, id: `${item.id}-${copy}` }))).flat();
    const samples = Array.from({ length: 50 }, () => {
      const start = performance.now();
      searchCharacters({ entries: scaled }, { query: "reimu", limit: 10 });
      return performance.now() - start;
    }).sort((left, right) => left - right);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(16);
  });
});
