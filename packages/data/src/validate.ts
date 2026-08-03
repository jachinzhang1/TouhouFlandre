import { demoCharacters, demoWorks } from ".";

const characterIds = new Set(demoCharacters.map((character) => character.id));
const workIds = new Set(demoWorks.map((work) => work.id));

if (characterIds.size !== demoCharacters.length) {
  throw new Error("Duplicate character ids found.");
}

for (const character of demoCharacters) {
  if (!workIds.has(character.firstAppearance.workId)) {
    throw new Error(`${character.id} references missing work ${character.firstAppearance.workId}.`);
  }
}

console.log(`Validated ${demoCharacters.length} characters and ${demoWorks.length} works.`);
