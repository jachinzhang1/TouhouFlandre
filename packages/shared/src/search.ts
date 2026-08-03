import type {
  Character,
  CharacterSearchResponse,
  CharacterSearchResult,
} from "./types";

const normalize = (value: string) =>
  value
    .toLocaleLowerCase()
    .normalize("NFKC")
    .replace(/[\s_.・·-]/g, "");

const searchableText = (character: Character) =>
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
  hairColors: character.hairColors,
});

export type CharacterSearchOptions = {
  limit?: number;
  offset?: number;
};

export const searchCharacters = (
  characters: Character[],
  query: string,
  options: CharacterSearchOptions = {},
): CharacterSearchResponse => {
  const normalizedQuery = normalize(query);
  const guessable = characters.filter((character) => character.enabledAsGuess);
  const matches = normalizedQuery
    ? guessable
        .map((character) => {
          const haystack = normalize(searchableText(character));
          const startsWith = haystack.startsWith(normalizedQuery);
          const includes = haystack.includes(normalizedQuery);
          return { character, score: startsWith ? 0 : includes ? 1 : 2 };
        })
        .filter((entry) => entry.score < 2)
        .sort(
          (left, right) =>
            left.score - right.score ||
            left.character.names.zhHans.localeCompare(
              right.character.names.zhHans,
            ),
        )
        .map((entry) => entry.character)
    : guessable;

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
