import type { Character } from "./types";

const hashString = (value: string) => {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const PUZZLE_TIME_ZONE = "Asia/Shanghai";

export const getPuzzleDateKey = (
  date = new Date(),
  timeZone = PUZZLE_TIME_ZONE,
) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
};

export const getDailyAnswer = (
  characters: Character[],
  dateKey = getPuzzleDateKey(),
) => {
  const answerPool = characters.filter(
    (character) => character.enabledAsAnswer,
  );
  if (!answerPool.length) {
    throw new Error("Daily puzzle requires at least one enabled answer.");
  }

  return answerPool.reduce((selected, character) => {
    const selectedScore = hashString(`touhoufriberg:${dateKey}:${selected.id}`);
    const score = hashString(`touhoufriberg:${dateKey}:${character.id}`);
    return score > selectedScore ? character : selected;
  });
};
