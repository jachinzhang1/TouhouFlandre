import type { Character } from "./types";

const hashString = (value: string) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const getPuzzleDateKey = (date = new Date()) => date.toISOString().slice(0, 10);

export const getDailyAnswer = (characters: Character[], dateKey = getPuzzleDateKey()) => {
  const answerPool = characters.filter((character) => character.enabledAsAnswer);
  if (!answerPool.length) {
    throw new Error("Daily puzzle requires at least one enabled answer.");
  }

  const index = hashString(`touhoufriberg:${dateKey}`) % answerPool.length;
  return answerPool[index];
};
