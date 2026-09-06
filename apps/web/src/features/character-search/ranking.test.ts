import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  compareSearchMatchRanks,
  rankSearchTerms,
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
      searchTerms: string[];
      expectedRank: SearchMatchRank | null;
    }>;
    expectedIds: string[];
  }>;
};

const fixture = JSON.parse(
  readFileSync(
    "../../docs/hybrid-search-optimization/fixtures/search-ranking-v1.json",
    "utf8",
  ),
) as RankingFixture;

describe("character search relevance ranking", () => {
  it("matches every language-neutral ranking case", () => {
    expect(fixture.contract).toBe("hso.search-ranking.v1");

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
