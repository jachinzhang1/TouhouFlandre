export type SearchMatchKind = "exact" | "prefix" | "substring";

export type SearchMatchRank = {
  kind: SearchMatchKind;
  position: number;
  lengthGap: number;
};

const KIND_ORDER: Record<SearchMatchKind, number> = {
  exact: 0,
  prefix: 1,
  substring: 2,
};

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
  normalizedTerms: readonly string[],
): SearchMatchRank | null {
  const query = Array.from(normalizedQuery);
  if (query.length === 0) return null;

  let best: SearchMatchRank | null = null;
  for (const value of normalizedTerms) {
    const term = Array.from(value);
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
    left.position - right.position ||
    left.lengthGap - right.lengthGap
  );
}
