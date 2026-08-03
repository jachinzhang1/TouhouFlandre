import charactersJson from "./characters.demo.json";
import worksJson from "./works.demo.json";
import { charactersSchema, worksSchema } from "./schema";
import type { Character } from "@touhoufriberg/shared";

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
    firstAppearance: {
      workId: work.id,
      workTitle: work.titleZh,
      workType: work.type,
      releaseYear: work.releaseYear,
      mainlineIndex: work.mainlineIndex,
      era: work.era,
    },
  };
});

export * from "./schema";
