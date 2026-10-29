import type {
  CatalogSearchIndexEntry,
  CharacterSort,
  SortDirection,
} from "@touhouflandre/shared";
import {
  compareSearchMatchRankSequences,
  rankSearchTerms,
  type SearchMatchRank,
} from "./ranking";
import {
  matchesSearchQuery,
  searchTermsForDomain,
  type NormalizedSearchQuery,
} from "./matching";
import { parseSearchQuery, type ParsedSearchQuery } from "./query";

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

function normalizeParsedSearchQuery(
  query: ParsedSearchQuery,
): NormalizedSearchQuery {
  return query.kind === "plain"
    ? { kind: "plain", text: normalizeSearchText(query.text) }
    : {
        kind: "scoped",
        characterText: normalizeSearchText(query.characterText),
        workText: normalizeSearchText(query.workText),
      };
}

function hasSearchText(query: NormalizedSearchQuery): boolean {
  return query.kind === "plain"
    ? query.text !== ""
    : query.characterText !== "" || query.workText !== "";
}

function rankSearchQuery(
  query: NormalizedSearchQuery,
  terms: readonly CatalogSearchIndexEntry["searchTerms"][number][],
): SearchMatchRank[] | null {
  if (query.kind === "plain") {
    const rank = rankSearchTerms(
      query.text,
      searchTermsForDomain(terms, "character"),
    );
    return rank === null ? null : [rank];
  }
  const ranks: SearchMatchRank[] = [];
  if (query.characterText !== "") {
    const rank = rankSearchTerms(
      query.characterText,
      searchTermsForDomain(terms, "character"),
    );
    if (rank === null) return null;
    ranks.push(rank);
  }
  if (query.workText !== "") {
    const rank = rankSearchTerms(
      query.workText,
      searchTermsForDomain(terms, "work"),
    );
    if (rank === null) return null;
    ranks.push(rank);
  }
  return ranks;
}

export function searchCharacters(
  index: { entries: readonly CatalogSearchIndexEntry[] },
  options: CharacterSearchOptions = {},
): CharacterSearchEngineResult {
  const query = normalizeParsedSearchQuery(
    parseSearchQuery(options.query ?? ""),
  );
  const allowed =
    options.allowedIds === undefined ? undefined : new Set(options.allowedIds);
  const works =
    options.workIds === undefined ? undefined : new Set(options.workIds);
  const sortBy = options.sortBy ?? "appearance";
  const useRelevance = sortBy === "relevance" && hasSearchText(query);
  const matches: Array<{
    entry: CatalogSearchIndexEntry;
    rank: SearchMatchRank[] | null;
  }> = [];
  for (const entry of index.entries) {
    if (allowed !== undefined && !allowed.has(entry.id)) continue;
    if (works !== undefined && !works.has(entry.workId)) continue;
    if (!matchesSearchQuery(query, entry.searchTerms)) continue;
    const rank = useRelevance
      ? rankSearchQuery(query, entry.searchTerms)
      : null;
    matches.push({ entry, rank });
  }
  const descending = options.direction === "desc";
  const sorted = [...matches].sort((left, right) => {
    if (sortBy === "relevance") {
      if (useRelevance) {
        if (left.rank !== null && right.rank === null) return -1;
        if (left.rank === null && right.rank !== null) return 1;
        if (left.rank !== null && right.rank !== null) {
          const comparison = compareSearchMatchRankSequences(
            left.rank,
            right.rank,
          );
          if (comparison !== 0) return descending ? -comparison : comparison;
        }
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
