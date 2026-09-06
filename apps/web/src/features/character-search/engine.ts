import type {
  CatalogSearchIndexEntry,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import {
  compareSearchMatchRanks,
  rankSearchTerms,
  type SearchMatchRank,
} from "./ranking";

export type CharacterSearchEngineResult = {
  results: CatalogSearchIndexEntry[];
  total: number;
};

export type CharacterSearchOptions = {
  query?: string;
  allowedIds?: readonly string[];
  workIds?: readonly string[];
  sortBy?: CharacterSort;
  direction?: SortDirection;
  offset?: number;
  limit?: number;
};

export function normalizeSearchText(value: string): string {
  return [...value.toLocaleLowerCase().normalize("NFKC")]
    .filter((char) => !/[\s_.・·-]/u.test(char))
    .join("");
}

export function searchCharacters(
  index: { entries: readonly CatalogSearchIndexEntry[] },
  options: CharacterSearchOptions = {},
): CharacterSearchEngineResult {
  const query = normalizeSearchText(options.query ?? "");
  const allowed =
    options.allowedIds === undefined ? undefined : new Set(options.allowedIds);
  const works =
    options.workIds === undefined ? undefined : new Set(options.workIds);
  const sortBy = options.sortBy ?? "appearance";
  const useRelevance = sortBy === "relevance" && query !== "";
  const matches: Array<{
    entry: CatalogSearchIndexEntry;
    rank: SearchMatchRank | null;
  }> = [];
  for (const entry of index.entries) {
    if (allowed !== undefined && !allowed.has(entry.id)) continue;
    if (works !== undefined && !works.has(entry.workId)) continue;
    let rank: SearchMatchRank | null = null;
    if (query !== "") {
      if (useRelevance) {
        rank = rankSearchTerms(query, entry.searchTerms);
        if (rank === null) continue;
      } else if (
        !entry.searchTerms.some((term) => term.value.includes(query))
      ) {
        continue;
      }
    }
    matches.push({ entry, rank });
  }
  const descending = options.direction === "desc";
  const sorted = [...matches].sort((left, right) => {
    if (sortBy === "relevance") {
      if (useRelevance) {
        const comparison = compareSearchMatchRanks(left.rank!, right.rank!);
        if (comparison !== 0) return descending ? -comparison : comparison;
      }
      return (
        left.entry.appearanceOrder - right.entry.appearanceOrder ||
        left.entry.id.localeCompare(right.entry.id)
      );
    }
    const comparison =
      sortBy === "appearance"
        ? left.entry.appearanceOrder - right.entry.appearanceOrder
        : left.entry.nameSortKey.localeCompare(right.entry.nameSortKey);
    if (comparison === 0) return left.entry.id.localeCompare(right.entry.id);
    return descending ? -comparison : comparison;
  });
  const total = sorted.length;
  const start = Math.min(Math.max(options.offset ?? 0, 0), total);
  const end =
    options.limit === undefined || options.limit < 0
      ? total
      : Math.min(start + options.limit, total);
  return { results: sorted.slice(start, end).map(({ entry }) => entry), total };
}
