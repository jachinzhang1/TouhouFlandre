import { describe, expect, it } from "vitest";
import type { FeedbackStatus, PublicGameSession } from "./types";
import { createShareText } from "./share";

const feedback = (statuses: FeedbackStatus[]) =>
  statuses.map((status, index) => ({
    field: [
      "firstAppearance",
      "releaseYear",
      "species",
      "affiliations",
      "locations",
      "hairColors",
    ][index] as PublicGameSession["guesses"][number]["feedback"][number]["field"],
    label: "",
    status,
    symbol: "O" as const,
    displayValue: [],
  }));

describe("createShareText", () => {
  it("creates a compact Wordle-style result", () => {
    const session = {
      id: "session-1",
      mode: "daily",
      contentType: "character",
      status: "won",
      maxGuesses: 8,
      startedAt: "2026-08-11T00:00:00.000Z",
      guesses: [
        {
          guessId: "one",
          guessName: "one",
          isCorrect: false,
          feedback: feedback(["miss", "lower", "partial", "miss", "exact", "miss"]),
        },
        {
          guessId: "two",
          guessName: "two",
          isCorrect: false,
          feedback: feedback(["partial", "exact", "miss", "partial", "exact", "miss"]),
        },
        {
          guessId: "three",
          guessName: "three",
          isCorrect: true,
          feedback: feedback(["exact", "exact", "exact", "exact", "exact", "exact"]),
        },
      ],
    } satisfies PublicGameSession;

    expect(
      createShareText(
        session,
        "每日题 2026-08-11 · Normal",
        "https://touhouflandre.com",
      ),
    ).toBe(`东方芙一把 每日题 2026-08-11 · Normal
3/8

⬛ 🟦 🟨 ⬛ 🟩 ⬛
🟨 🟩 ⬛ 🟨 🟩 ⬛
🟩 🟩 🟩 🟩 🟩 🟩

https://touhouflandre.com`);
  });
});
