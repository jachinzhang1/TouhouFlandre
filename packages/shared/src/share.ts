import type { GuessResult, PublicGameSession } from "./types";
import { GAME_CONTENT_DEFINITIONS } from "./fields";

const rowToShareLine = (guess: GuessResult) =>
  guess.feedback.map((field) => field.symbol).join(" ");

export const createShareText = (
  session: PublicGameSession,
  puzzleLabel: string,
  siteUrl = "http://localhost:5173",
) => {
  const result =
    session.status === "won"
      ? `${session.guesses.length}/${session.maxGuesses}`
      : `X/${session.maxGuesses}`;
  const lines = [
    `TouhouFlandre ${puzzleLabel}`,
    result,
    GAME_CONTENT_DEFINITIONS[session.contentType].fields
      .filter((field) => field.visible)
      .map((field) => field.label)
      .join(" "),
    ...session.guesses.map(rowToShareLine),
    siteUrl,
  ];

  return lines.join("\n");
};
