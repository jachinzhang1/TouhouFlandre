import type { Character, CharacterSearchResult } from "./types";

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
    character.firstAppearance.mainlineIndex ? `TH${String(character.firstAppearance.mainlineIndex).padStart(2, "0")}` : undefined,
    character.firstAppearance.mainlineIndex ? `th${String(character.firstAppearance.mainlineIndex).padStart(2, "0")}` : undefined
  ]
    .filter(Boolean)
    .join(" ");

export const toSearchResult = (character: Character): CharacterSearchResult => ({
  id: character.id,
  name: character.names.zhHans,
  subtitle: `${character.names.en} · ${character.firstAppearance.workTitle}`,
  initials: character.names.zhHans.slice(0, 2),
  hairColors: character.hairColors
});

export const searchCharacters = (characters: Character[], query: string, limit = 12) => {
  const normalizedQuery = normalize(query);
  const guessable = characters.filter((character) => character.enabledAsGuess);
  if (!normalizedQuery) return guessable.slice(0, limit).map(toSearchResult);

  return guessable
    .map((character) => {
      const haystack = normalize(searchableText(character));
      const startsWith = haystack.startsWith(normalizedQuery);
      const includes = haystack.includes(normalizedQuery);
      return { character, score: startsWith ? 0 : includes ? 1 : 2 };
    })
    .filter((entry) => entry.score < 2)
    .sort((left, right) => left.score - right.score || left.character.names.zhHans.localeCompare(right.character.names.zhHans))
    .slice(0, limit)
    .map((entry) => toSearchResult(entry.character));
};
