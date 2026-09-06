import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeSearchText, searchCharacters } from "./engine";
import type {
  CatalogSearchIndexEntry,
  CatalogSearchTerm,
  SearchTermSource,
} from "@touhouflandre/shared";

const terms = (
  values: string[],
  source: SearchTermSource = "en",
): CatalogSearchTerm[] => values.map((value) => ({ value, source }));

const entry = (
  id: string,
  appearanceOrder: number,
  nameSortKey: string,
  searchTerms: CatalogSearchTerm[],
  workId = "th06_eosd",
): CatalogSearchIndexEntry => ({
  id,
  name: id,
  subtitle: id,
  initials: id.slice(0, 2),
  avatarUrl: "",
  appearanceOrder,
  workId,
  firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 },
  species: [],
  locations: [],
  affiliations: [],
  hairColors: [],
  searchTerms,
  nameSortKey,
});

const entries = [
  entry("zeta", 2, "zeta", terms(["reimuhakurei", "th06"])),
  entry("alpha", 1, "alpha", terms(["marisakirisame", "th07"]), "th07_pcb"),
  entry("beta", 1, "beta", terms(["秋姐妹"], "alias")),
];

const fixture = JSON.parse(
  readFileSync(
    "../../docs/hybrid-search-optimization/fixtures/search-parity-v2.json",
    "utf8",
  ),
) as {
  characters: Array<Record<string, any>>;
  cases: Array<Record<string, any>>;
};
const fixtureEntries = fixture.characters
  .filter((character) => character.enabledAsGuess)
  .map((character) => {
    const names = character.names;
    const appearance = character.firstAppearance;
    const values: Array<{ value: unknown; source: SearchTermSource }> = [
      { value: names.zhHans, source: "zhHans" },
      { value: names.zhHant, source: "zhHant" },
      { value: names.ja, source: "ja" },
      { value: names.en, source: "en" },
      { value: names.romaji, source: "romaji" },
      ...names.aliases.map((value: string) => ({
        value,
        source: "alias" as const,
      })),
      { value: appearance.workTitle, source: "workTitle" },
      { value: appearance.workId, source: "workId" },
      ...appearance.workPinyinInitials.map((value: string) => ({
        value,
        source: "workPinyinInitials" as const,
      })),
      {
        value:
          appearance.mainlineIndex == null
            ? undefined
            : `TH${String(appearance.mainlineIndex).padStart(2, "0")}`,
        source: "mainlineIndex",
      },
    ];
    const seen = new Set<string>();
    const searchTerms = values.flatMap(({ value, source }) => {
      if (typeof value !== "string") return [];
      const normalized = normalizeSearchText(value);
      const key = `${source}\u0000${normalized}`;
      if (normalized === "" || seen.has(key)) return [];
      seen.add(key);
      return [{ value: normalized, source }];
    });
    return entry(
      character.id,
      character.appearanceOrder,
      normalizeSearchText(names.romaji ?? names.en),
      searchTerms,
      appearance.workId,
    );
  });

describe("character search engine", () => {
  it("matches every HSO-001 golden sample", () => {
    for (const testCase of fixture.cases) {
      const result = searchCharacters(
        { entries: fixtureEntries },
        {
          query: testCase.query,
          allowedIds:
            testCase.selectedCharacterIds === null
              ? undefined
              : testCase.selectedCharacterIds,
          workIds: testCase.workIds ?? undefined,
          sortBy: testCase.sortBy,
          direction: testCase.descending ? "desc" : "asc",
          offset: testCase.offset,
          limit: testCase.limit,
        },
      );
      expect(
        { ids: result.results.map((item) => item.id), total: result.total },
        testCase.name,
      ).toEqual(testCase.expected);
    }
  });

  it("matches Go normalization without crossing term boundaries", () => {
    expect(normalizeSearchText(" Ｒｅｉｍｕ・Hakurei ")).toBe("reimuhakurei");
    expect(
      searchCharacters({ entries }, { query: "Reimu-Hakurei" }).results.map(
        (item) => item.id,
      ),
    ).toEqual(["zeta"]);
    expect(
      searchCharacters(
        { entries },
        { query: "reimuhakurei", workIds: ["th07_pcb"] },
      ).total,
    ).toBe(0);
    expect(searchCharacters({ entries }, { query: "marisa秋" }).total).toBe(0);
  });

  it("filters before paging and fails closed for an empty scope", () => {
    expect(searchCharacters({ entries }, { allowedIds: [] })).toEqual({
      results: [],
      total: 0,
    });
    expect(
      searchCharacters(
        { entries },
        { allowedIds: ["alpha", "beta"], offset: 1, limit: 1 },
      ).results.map((item) => item.id),
    ).toEqual(["beta"]);
  });

  it("uses stable id tie-breaks in both directions", () => {
    const ascending = searchCharacters(
      { entries },
      { sortBy: "appearance" },
    ).results.map((item) => item.id);
    const descending = searchCharacters(
      { entries },
      { sortBy: "appearance", direction: "desc" },
    ).results.map((item) => item.id);
    expect(ascending).toEqual(["alpha", "beta", "zeta"]);
    expect(descending).toEqual(["zeta", "alpha", "beta"]);
  });

  it("prefers higher-priority fields after match kind", () => {
    const weighted = [
      entry("work", 1, "work", terms(["灵梦"], "workTitle")),
      entry("alias", 2, "alias", terms(["灵梦"], "alias")),
      entry("other", 3, "other", terms(["灵梦"], "ja")),
      entry("chinese", 4, "chinese", terms(["灵梦"], "zhHans")),
    ];
    expect(
      searchCharacters(
        { entries: weighted },
        { query: "灵梦", sortBy: "relevance" },
      ).results.map((item) => item.id),
    ).toEqual(["chinese", "other", "alias", "work"]);
  });

  it("keeps fixed production-scale synchronous search under the 16ms p95 budget", () => {
    const scaled = Array.from({ length: 8 }, (_, copy) =>
      fixtureEntries.map((item) => ({ ...item, id: `${item.id}-${copy}` })),
    ).flat();
    const samples = Array.from({ length: 50 }, () => {
      const start = performance.now();
      searchCharacters(
        { entries: scaled },
        { query: "reimu", sortBy: "relevance", limit: 10 },
      );
      return performance.now() - start;
    }).sort((left, right) => left - right);
    expect(samples[Math.floor(samples.length * 0.95)]).toBeLessThan(16);
  });
});
