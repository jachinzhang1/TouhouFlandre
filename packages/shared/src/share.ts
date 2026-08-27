import type {
  FeedbackStatus,
  GuessResult,
  PublicGameSession,
} from "./types";
import { isUnlimitedGuessLimit } from "./questionScope";

const SHARE_SYMBOLS: Record<FeedbackStatus, string> = {
  exact: "🟩",
  partial: "🟨",
  higher: "🟥",
  lower: "🟦",
  miss: "⬛",
  unknown: "❔",
};

const rowToShareLine = (guess: GuessResult, fieldCount: number) =>
  guess.kind === "timeout"
    ? Array.from({ length: fieldCount }, () => "⏱️").join(" ")
    : guess.feedback.map((field) => SHARE_SYMBOLS[field.status]).join(" ");

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
  const fieldCount =
    session.activeFields?.length ?? session.guesses[0]?.feedback.length ?? 0;
  const lines = [
    `东方芙一把 ${puzzleLabel}`,
    result,
    "",
    ...session.guesses.map((guess) => rowToShareLine(guess, fieldCount)),
    "",
    siteUrl,
  ];

  return lines.join("\n");
};
