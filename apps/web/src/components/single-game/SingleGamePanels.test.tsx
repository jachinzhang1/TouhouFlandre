import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublicGameSession } from "@touhouflandre/shared";
import { SingleGuessHistory } from "./SingleGamePanels";

const session = (guesses: PublicGameSession["guesses"]): PublicGameSession => ({
  id: "history-layout",
  mode: "daily",
  contentType: "character",
  status: "playing",
  maxGuesses: 8,
  guesses,
  startedAt: "2026-08-14T12:00:00Z",
});

const reimuGuess: PublicGameSession["guesses"][number] = {
  guessAvatarUrl: "/characters/0001-博丽灵梦.png",
  kind: "guess",
  guessId: "reimu_hakurei",
  guessName: "博丽灵梦",
  isCorrect: false,
  feedback: [],
};

const timeoutGuess: PublicGameSession["guesses"][number] = {
  kind: "timeout",
  guessId: "timeout-2",
  guessName: "超时空过",
  isCorrect: false,
  feedback: [],
};

describe("SingleGuessHistory", () => {
  it("keeps chronological rows at the bottom and follows each new guess", () => {
    const { rerender } = render(
      <SingleGuessHistory
        session={session([])}
        visibleFields={[]}
        guessCompletedElapsedMs={[]}
        loading={false}
        message=""
      />,
    );
    const viewport = screen.getByRole("region", { name: "猜测记录" });
    expect(viewport.closest(".paper-surface")).toBeNull();
    expect(
      viewport.querySelector(".single-game-history-table-paper"),
    ).toBeNull();
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 480,
    });

    rerender(
      <SingleGuessHistory
        session={session([reimuGuess])}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000]}
        loading={false}
        message=""
      />,
    );
    expect(viewport.scrollTop).toBe(480);
    const tablePaper = viewport.querySelector(
      ".single-game-history-table-paper",
    ) as HTMLElement;
    expect(tablePaper).toBeTruthy();
    expect(tablePaper.dataset.paperVariant).toBe("plain");

    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 720,
    });
    rerender(
      <SingleGuessHistory
        session={session([reimuGuess, timeoutGuess])}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000, 12_000]}
        loading={false}
        message=""
      />,
    );

    const body = viewport.querySelector("tbody");
    expect(body).not.toBeNull();
    const rows = within(body as HTMLElement).getAllByRole("row");
    expect(rows.map((row) => row.textContent)).toEqual([
      "博丽灵梦00:04",
      "超时空过00:08",
    ]);
    expect(viewport.scrollTop).toBe(720);
  });
});
