import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoCharacters, demoWorks } from ".";
import { normalizeSearchText } from "@touhoufriberg/shared";

const characterIds = new Set(demoCharacters.map((character) => character.id));
const characterAvatarUrls = new Set(
  demoCharacters.map((character) => character.avatarUrl),
);
const workIds = new Set(demoWorks.map((work) => work.id));
const appearanceOrders = new Set(
  demoCharacters.map((character) => character.appearanceOrder),
);

if (characterIds.size !== demoCharacters.length) {
  throw new Error("Duplicate character ids found.");
}

if (characterAvatarUrls.size !== demoCharacters.length) {
  throw new Error("Duplicate character avatar URLs found.");
}

if (workIds.size !== demoWorks.length) {
  throw new Error("Duplicate work ids found.");
}

if (appearanceOrders.size !== demoCharacters.length) {
  throw new Error("Duplicate character appearance orders found.");
}

const names = new Map<string, string>();
for (const character of demoCharacters) {
  const characterNames = [
    character.names.zhHans,
    character.names.zhHant,
    character.names.ja,
    character.names.en,
    character.names.romaji,
    ...character.names.aliases,
  ].filter((value): value is string => Boolean(value));
  for (const name of characterNames) {
    const normalized = normalizeSearchText(name);
    const owner = names.get(normalized);
    if (owner && owner !== character.id) {
      throw new Error(
        `Search name ${name} is shared by ${owner} and ${character.id}.`,
      );
    }
    names.set(normalized, character.id);
  }
}

for (const character of demoCharacters) {
  if (!workIds.has(character.firstAppearance.workId)) {
    throw new Error(
      `${character.id} references missing work ${character.firstAppearance.workId}.`,
    );
  }

  const avatarFile = fileURLToPath(
    new URL(`../../../apps/web/public${character.avatarUrl}`, import.meta.url),
  );
  if (!existsSync(avatarFile)) {
    throw new Error(`${character.id} references missing avatar ${avatarFile}.`);
  }
}

console.log(
  `Validated ${demoCharacters.length} characters and ${demoWorks.length} works.`,
);
