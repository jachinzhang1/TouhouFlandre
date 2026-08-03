import type {
  Character,
  CharacterSort,
  CharacterSearchResponse,
  CharacterSearchResult,
  SortDirection,
} from "./types";

export const normalizeSearchText = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\s_.・·-]/g, "");

export const characterSearchText = (character: Character) =>
  [
    character.names.zhHans,
    character.names.zhHant,
    character.names.ja,
    character.names.en,
    character.names.romaji,
    ...character.names.aliases,
    character.firstAppearance.workTitle,
    character.firstAppearance.workId,
    character.firstAppearance.mainlineIndex
      ? `TH${String(character.firstAppearance.mainlineIndex).padStart(2, "0")}`
      : undefined,
    character.firstAppearance.mainlineIndex
      ? `th${String(character.firstAppearance.mainlineIndex).padStart(2, "0")}`
      : undefined,
  ]
    .filter(Boolean)
    .join(" ");

export const toSearchResult = (
  character: Character,
): CharacterSearchResult => ({
  id: character.id,
  name: character.names.zhHans,
  subtitle: `${character.names.en} · ${character.firstAppearance.workTitle}`,
  initials: character.names.zhHans.slice(0, 2),
  avatarUrl: character.avatarUrl,
  appearanceOrder: character.appearanceOrder,
  firstAppearance: {
    workTitle: character.firstAppearance.workTitle,
    releaseYear: character.firstAppearance.releaseYear,
  },
  species: character.species,
  locations: character.locations,
  affiliations: character.affiliations,
  hairColors: character.hairColors,
});

export type CharacterSearchOptions = {
  limit?: number;
  offset?: number;
  sort?: CharacterSort;
  direction?: SortDirection;
};

export const characterNameSortKey = (character: Character) =>
  normalizeSearchText(character.names.romaji ?? character.names.en);

export const compareCharacters = (
  left: Character,
  right: Character,
  sort: CharacterSort = "name",
  direction: SortDirection = "asc",
) => {
  const order =
    sort === "appearance"
      ? left.appearanceOrder - right.appearanceOrder
      : characterNameSortKey(left).localeCompare(characterNameSortKey(right));
  const fallback = left.id.localeCompare(right.id);
  return (order || fallback) * (direction === "asc" ? 1 : -1);
};

export const searchCharacters = (
  characters: Character[],
  query: string,
  options: CharacterSearchOptions = {},
): CharacterSearchResponse => {
  const normalizedQuery = normalizeSearchText(query);
  const guessable = characters.filter((character) => character.enabledAsGuess);
  const matches = normalizedQuery
    ? guessable
        .map((character) => {
          const haystack = normalizeSearchText(characterSearchText(character));
          const startsWith = haystack.startsWith(normalizedQuery);
          const includes = haystack.includes(normalizedQuery);
          return { character, score: startsWith ? 0 : includes ? 1 : 2 };
        })
        .filter((entry) => entry.score < 2)
        .sort((left, right) =>
          left.score === right.score
            ? compareCharacters(
                left.character,
                right.character,
                options.sort,
                options.direction,
              )
            : left.score - right.score,
        )
        .map((entry) => entry.character)
    : guessable.sort((left, right) =>
        compareCharacters(left, right, options.sort, options.direction),
      );

  const offset = Math.max(0, options.offset ?? 0);
  const end =
    options.limit === undefined
      ? undefined
      : offset + Math.max(0, options.limit);

  return {
    results: matches.slice(offset, end).map(toSearchResult),
    total: matches.length,
  };
};
