import type { GuessResult, PublicGameSession } from "./types";

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
    "作品 年份 种族 阵营 地点 发色",
    ...session.guesses.map(rowToShareLine),
    siteUrl,
  ];

  return lines.join("\n");
};
