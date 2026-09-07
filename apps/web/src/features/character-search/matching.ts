import type {
  CatalogSearchTerm,
  SearchTermSource,
} from "@touhouflandre/shared";
import type { ParsedSearchQuery } from "./query";

export type SearchTermDomain = "character" | "work";

export type NormalizedSearchQuery = ParsedSearchQuery;

export function searchTermDomain(source: SearchTermSource): SearchTermDomain {
  switch (source) {
    case "zhHans":
    case "zhHant":
    case "ja":
    case "en":
    case "romaji":
    case "alias":
      return "character";
    case "workTitle":
    case "workId":
    case "workPinyinInitials":
    case "mainlineIndex":
      return "work";
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

export function searchTermsForDomain(
  terms: readonly CatalogSearchTerm[],
  domain: SearchTermDomain,
): CatalogSearchTerm[] {
  return terms.filter((term) => searchTermDomain(term.source) === domain);
}

function matchesTerm(
  query: string,
  terms: readonly CatalogSearchTerm[],
  domain?: SearchTermDomain,
): boolean {
  return terms.some(
    (term) =>
      (domain === undefined || searchTermDomain(term.source) === domain) &&
      term.value.includes(query),
  );
}

export function matchesSearchQuery(
  query: NormalizedSearchQuery,
  terms: readonly CatalogSearchTerm[],
): boolean {
  if (query.kind === "plain") {
    return query.text === "" || matchesTerm(query.text, terms, "character");
  }
  if (query.characterText === "" && query.workText === "") return false;
  return (
    (query.characterText === "" ||
      matchesTerm(query.characterText, terms, "character")) &&
    (query.workText === "" || matchesTerm(query.workText, terms, "work"))
  );
}
