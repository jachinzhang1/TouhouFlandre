import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CatalogSearchTerm } from "@touhouflandre/shared";
import {
  compareSearchMatchRanks,
  rankSearchTerms,
  searchTermFieldPriority,
  type SearchMatchRank,
} from "./ranking";

type RankingFixture = {
  contract: string;
  cases: Array<{
    name: string;
    query: string;
    descending: boolean;
    entries: Array<{
      id: string;
      appearanceOrder: number;
      searchTerms: CatalogSearchTerm[];
      expectedRank: SearchMatchRank | null;
    }>;
    expectedIds: string[];
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    "../../docs/hybrid-search-optimization/fixtures/search-ranking-v2.json",
    "utf8",
  ),
) as RankingFixture;

describe("character search relevance ranking", () => {
  it("maps every term source into the configured four priority groups", () => {
    expect({
      zhHans: searchTermFieldPriority("zhHans"),
      zhHant: searchTermFieldPriority("zhHant"),
      ja: searchTermFieldPriority("ja"),
      en: searchTermFieldPriority("en"),
      romaji: searchTermFieldPriority("romaji"),
      alias: searchTermFieldPriority("alias"),
      workTitle: searchTermFieldPriority("workTitle"),
      workId: searchTermFieldPriority("workId"),
      workPinyinInitials: searchTermFieldPriority("workPinyinInitials"),
      mainlineIndex: searchTermFieldPriority("mainlineIndex"),
    }).toEqual({
      zhHans: 0,
      zhHant: 0,
      ja: 1,
      en: 1,
      romaji: 1,
      alias: 2,
      workTitle: 3,
      workId: 3,
      workPinyinInitials: 3,
      mainlineIndex: 3,
    });
  });

  it("matches every language-neutral ranking case", () => {
    expect(fixture.contract).toBe("hso.search-ranking.v2");

    for (const testCase of fixture.cases) {
      const ranked = testCase.entries.flatMap((entry) => {
        const rank = rankSearchTerms(testCase.query, entry.searchTerms);
        expect(rank, `${testCase.name}: ${entry.id}`).toEqual(
          entry.expectedRank,
        );
        if (testCase.query !== "" && rank === null) return [];
        return [{ entry, rank }];
      });

      ranked.sort((left, right) => {
        if (left.rank !== null && right.rank !== null) {
          const comparison = compareSearchMatchRanks(left.rank, right.rank);
          if (comparison !== 0) {
            return testCase.descending ? -comparison : comparison;
          }
        }
        return (
          left.entry.appearanceOrder - right.entry.appearanceOrder ||
          left.entry.id.localeCompare(right.entry.id)
        );
      });

      expect(
        ranked.map(({ entry }) => entry.id),
        testCase.name,
      ).toEqual(testCase.expectedIds);
    }
  });
});
