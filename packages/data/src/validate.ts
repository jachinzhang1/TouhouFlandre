import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { demoCharacters, demoWorks } from ".";

const characterIds = new Set(demoCharacters.map((character) => character.id));
const characterAvatarUrls = new Set(
  demoCharacters.map((character) => character.avatarUrl),
);
const workIds = new Set(demoWorks.map((work) => work.id));

if (characterIds.size !== demoCharacters.length) {
  throw new Error("Duplicate character ids found.");
}

if (characterAvatarUrls.size !== demoCharacters.length) {
  throw new Error("Duplicate character avatar URLs found.");
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
