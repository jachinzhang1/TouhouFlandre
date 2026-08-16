import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoCharacters, demoWorks } from ".";
import { normalizeSearchText } from "@touhouflandre/shared";

const characterIds = new Set(demoCharacters.map((character) => character.id));
const characterAvatarUrls = new Set(
  demoCharacters.map((character) => character.avatarUrl),
);
const workIds = new Set(demoWorks.map((work) => work.id));
const workPinyinInitials = new Map<string, string>();
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

for (const work of demoWorks) {
  for (const initials of work.pinyinInitials) {
    const owner = workPinyinInitials.get(initials);
    if (owner && owner !== work.id) {
      throw new Error(
        `Work pinyin initials ${initials} are shared by ${owner} and ${work.id}.`,
      );
    }
    workPinyinInitials.set(initials, work.id);
  }
}

if (appearanceOrders.size !== demoCharacters.length) {
  throw new Error("Duplicate character appearance orders found.");
}

const canonicalNames = new Map<string, string>();
for (const character of demoCharacters) {
  const characterCanonicalNames = [
    character.names.zhHans,
    character.names.zhHant,
    character.names.ja,
    character.names.en,
    character.names.romaji,
  ].filter((value): value is string => Boolean(value));
  for (const name of characterCanonicalNames) {
    const normalized = normalizeSearchText(name);
    const owner = canonicalNames.get(normalized);
    if (owner && owner !== character.id) {
      throw new Error(
        `Canonical name ${name} is shared by ${owner} and ${character.id}.`,
      );
    }
    canonicalNames.set(normalized, character.id);
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
