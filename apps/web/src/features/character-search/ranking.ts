import type {
  CatalogSearchTerm,
  SearchTermSource,
} from "@touhouflandre/shared";

export type SearchMatchKind = "exact" | "prefix" | "substring";

export type SearchMatchRank = {
  kind: SearchMatchKind;
  fieldPriority: number;
  position: number;
  lengthGap: number;
};

const KIND_ORDER: Record<SearchMatchKind, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
};

const FIELD_PRIORITY: Record<SearchTermSource, number> = {
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
};

export function searchTermFieldPriority(source: SearchTermSource): number {
  return FIELD_PRIORITY[source] ?? 4;
}

function codePointIndex(
  haystack: readonly string[],
  needle: readonly string[],
) {
  const lastStart = haystack.length - needle.length;
  for (let start = 0; start <= lastStart; start += 1) {
    if (needle.every((value, offset) => haystack[start + offset] === value)) {
      return start;
    }
  }
  return -1;
}

/**
 * Ranks normalized search terms. A lower rank is more relevant.
 * Empty queries deliberately have no relevance rank so callers can retain
 * their existing empty-query ordering.
 */
export function rankSearchTerms(
  normalizedQuery: string,
  normalizedTerms: readonly CatalogSearchTerm[],
): SearchMatchRank | null {
  const query = Array.from(normalizedQuery);
  if (query.length === 0) return null;

  let best: SearchMatchRank | null = null;
  for (const searchTerm of normalizedTerms) {
    const term = Array.from(searchTerm.value);
    const position = codePointIndex(term, query);
    if (position < 0) continue;

    const kind: SearchMatchKind =
      position === 0 && term.length === query.length
        ? "exact"
        : position === 0
          ? "prefix"
          : "substring";
    const rank = {
      kind,
      fieldPriority: searchTermFieldPriority(searchTerm.source),
      position,
      lengthGap: term.length - query.length,
    } satisfies SearchMatchRank;
    if (best === null || compareSearchMatchRanks(rank, best) < 0) best = rank;
  }
  return best;
}

export function compareSearchMatchRanks(
  left: SearchMatchRank,
  right: SearchMatchRank,
): number {
  return (
    KIND_ORDER[left.kind] - KIND_ORDER[right.kind] ||
    left.fieldPriority - right.fieldPriority ||
    left.position - right.position ||
    left.lengthGap - right.lengthGap
  );
}

export function compareSearchMatchRankSequences(
  left: readonly SearchMatchRank[],
  right: readonly SearchMatchRank[],
): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const comparison = compareSearchMatchRanks(left[index], right[index]);
    if (comparison !== 0) return comparison;
  }
  return left.length - right.length;
}
