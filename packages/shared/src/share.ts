import type { GuessResult, PublicGameSession } from "./types";
import { GAME_CONTENT_DEFINITIONS } from "./fields";
import { isUnlimitedGuessLimit, visibleQuestionFields } from "./questionScope";

const rowToShareLine = (guess: GuessResult) =>
  guess.kind === "timeout"
    ? "超时空过"
    : guess.feedback.map((field) => field.symbol).join(" ");

export const createShareText = (
  session: PublicGameSession,
  puzzleLabel: string,
  siteUrl = "http://localhost:5173",
) => {
  const maxGuessLabel = isUnlimitedGuessLimit(session.maxGuesses)
    ? "无限制"
    : session.maxGuesses;
  const result =
    session.status === "won"
      ? `${session.guesses.length}/${maxGuessLabel}`
      : `X/${maxGuessLabel}`;
  const lines = [
    `TouhouFlandre ${puzzleLabel}`,
    result,
    visibleQuestionFields(
      session.questionScope?.rules,
      GAME_CONTENT_DEFINITIONS[session.contentType].fields,
    )
      .map((field) => field.label)
      .join(" "),
    ...session.guesses.map(rowToShareLine),
    siteUrl,
  ];

  return lines.join("\n");
};
