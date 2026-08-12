import charactersJson from "./characters.demo.json";
import worksJson from "./works.demo.json";
import { charactersSchema, worksSchema } from "./schema";
import type { Character } from "@touhouflandre/shared";

export const getAppearanceOrder = (avatarUrl: string) => {
  const match = avatarUrl.match(/^\/characters\/(\d{4})-[^/]+\.png$/u);
  if (!match) {
    throw new Error(
      `Avatar URL does not contain a four-digit order: ${avatarUrl}`,
    );
  }
  return Number(match[1]);
};

const hashString = (value: string) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const demoWorks = worksSchema.parse(worksJson);
const characterSources = charactersSchema.parse(charactersJson);
const worksById = new Map(demoWorks.map((work) => [work.id, work]));

export const demoCharacters: Character[] = characterSources.map((character) => {
  const work = worksById.get(character.firstAppearance.workId);
  if (!work) {
    throw new Error(
      `${character.id} references missing work ${character.firstAppearance.workId}.`,
    );
  }

  return {
    ...character,
    appearanceOrder: getAppearanceOrder(character.avatarUrl),
    firstAppearance: {
      workId: work.id,
      workTitle: work.titleZh,
      workType: work.type,
      releaseYear: work.releaseYear,
      mainlineIndex: work.mainlineIndex,
      era: work.era,
      workPinyinInitials: work.pinyinInitials,
    },
  };
});

export const demoCatalogVersion = hashString(
  JSON.stringify({ works: demoWorks, characters: demoCharacters }),
);

export * from "./schema";
