import { CHARACTER_GUESS_FIELDS, HAIR_COLOR_LABELS } from "./fields";
import type {
  Character,
  FeedbackStatus,
  FieldFeedback,
  GuessField,
  GuessFieldKey,
  GuessResult,
} from "./types";

const statusToSymbol = (status: FeedbackStatus): FieldFeedback["symbol"] => {
  if (status === "exact") return "O";
  if (status === "partial") return "~";
  if (status === "higher") return "↑";
  if (status === "lower") return "↓";
  if (status === "unknown") return "?";
  return "X";
};

const sameSet = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
};

const hasIntersection = (left: string[], right: string[]) => {
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
};

const compareMultiSet = (
  guessValues: string[],
  answerValues: string[],
): FeedbackStatus => {
  if (!guessValues.length || !answerValues.length) return "unknown";
  if (sameSet(guessValues, answerValues)) return "exact";
  if (hasIntersection(guessValues, answerValues)) return "partial";
  return "miss";
};

const displayValuesForField = (
  character: Character,
  field: GuessFieldKey,
): string[] => {
  if (field === "firstAppearance") return [character.firstAppearance.workTitle];
  if (field === "releaseYear")
    return [String(character.firstAppearance.releaseYear)];
  if (field === "hairColors")
    return character.hairColors.map((color) => HAIR_COLOR_LABELS[color]);
  return character[field];
};

const valuesForField = (
  character: Character,
  field: GuessFieldKey,
): string[] => {
  if (field === "firstAppearance") return [character.firstAppearance.workId];
  if (field === "releaseYear")
    return [String(character.firstAppearance.releaseYear)];
  if (field === "hairColors") return character.hairColors;
  return character[field];
};

export const compareField = (
  guess: Character,
  answer: Character,
  field: GuessField,
): FieldFeedback => {
  let status: FeedbackStatus = "unknown";

  if (field.compareStrategy === "firstAppearance") {
    if (guess.firstAppearance.workId === answer.firstAppearance.workId) {
      status = "exact";
    } else if (
      guess.firstAppearance.workType === answer.firstAppearance.workType
    ) {
      status = "partial";
    } else {
      status = "miss";
    }
  }

  if (field.compareStrategy === "numberDirection") {
    const guessYear = guess.firstAppearance.releaseYear;
    const answerYear = answer.firstAppearance.releaseYear;
    if (guessYear === answerYear) status = "exact";
    else status = guessYear < answerYear ? "higher" : "lower";
  }

  if (field.compareStrategy === "multiSet") {
    status = compareMultiSet(
      valuesForField(guess, field.key),
      valuesForField(answer, field.key),
    );
  }

  return {
    field: field.key,
    label: field.label,
    status,
    symbol: statusToSymbol(status),
    displayValue: displayValuesForField(guess, field.key),
  };
};

export const compareCharacter = (
  guess: Character,
  answer: Character,
  fields: GuessField[] = CHARACTER_GUESS_FIELDS,
): GuessResult => ({
  guessId: guess.id,
  guessName: guess.names.zhHans,
  guessAvatarUrl: guess.avatarUrl,
  isCorrect: guess.id === answer.id,
  feedback: fields
    .filter((field) => field.visible)
    .map((field) => compareField(guess, answer, field)),
});
