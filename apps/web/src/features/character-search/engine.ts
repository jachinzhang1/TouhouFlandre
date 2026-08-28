import type { CatalogSearchIndexEntry, CharacterSort, SortDirection } from "@touhouflandre/shared";

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
    .filter((char) => !(/[\s_.・·-]/u.test(char)))
    .join("");
}

export function searchCharacters(index: { entries: readonly CatalogSearchIndexEntry[] }, options: CharacterSearchOptions = {}): CharacterSearchEngineResult {
  const query = normalizeSearchText(options.query ?? "");
  const allowed = options.allowedIds === undefined ? undefined : new Set(options.allowedIds);
  const works = options.workIds === undefined ? undefined : new Set(options.workIds);
  const matches = index.entries.filter((entry) => {
    if (allowed !== undefined && !allowed.has(entry.id)) return false;
    if (works !== undefined && !works.has(entry.workId)) return false;
    return query === "" || entry.searchTerms.some((term) => term.includes(query));
  });
  const descending = options.direction === "desc";
  const sortBy = options.sortBy ?? "appearance";
  const sorted = [...matches].sort((left, right) => {
    const comparison = sortBy === "appearance"
      ? left.appearanceOrder - right.appearanceOrder
      : left.nameSortKey.localeCompare(right.nameSortKey);
    if (comparison === 0) return left.id.localeCompare(right.id);
    return descending ? -comparison : comparison;
  });
  const total = sorted.length;
  const start = Math.min(Math.max(options.offset ?? 0, 0), total);
  const end = options.limit === undefined || options.limit < 0
    ? total
    : Math.min(start + options.limit, total);
  return { results: sorted.slice(start, end), total };
}
