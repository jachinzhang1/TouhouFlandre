import { fireEvent, render, screen, within } from "@testing-library/react";
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

const correctGuess: PublicGameSession["guesses"][number] = {
  kind: "guess",
  guessId: "flandre_scarlet",
  guessName: "芙兰朵露·斯卡蕾特",
  isCorrect: true,
  feedback: [],
};

const wonHistorySession = {
  ...session([reimuGuess, correctGuess]),
  status: "won",
} as PublicGameSession;

const lostHistorySession = {
  ...session([reimuGuess, timeoutGuess]),
  status: "lost",
} as PublicGameSession;

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
    expect(tablePaper.classList.contains("paper-data-table")).toBe(true);
    expect(
      viewport.querySelector(".single-game-history-fade-spacer"),
    ).toBeTruthy();
    const footer = viewport.querySelector("tfoot");
    expect(footer?.classList.contains("paper-data-table-header")).toBe(true);
    expect(footer?.previousElementSibling?.tagName).toBe("TBODY");
    expect(within(footer as HTMLElement).getByText("角色")).toBeTruthy();
    expect(
      within(footer as HTMLElement).getByText("本次猜测用时"),
    ).toBeTruthy();
    expect(viewport.querySelector("thead")).toBeNull();

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
    expect(body?.classList.contains("paper-data-table-body")).toBe(true);
    expect(
      rows.every((row) => row.classList.contains("paper-data-table-row")),
    ).toBe(true);
    expect(rows.map((row) => row.textContent)).toEqual([
      "博丽灵梦00:04",
      "超时跳过00:08",
    ]);
    expect(viewport.scrollTop).toBe(720);
    viewport.scrollLeft = 24;
    fireEvent.scroll(viewport);
    expect(viewport.dataset.scrollX).toBe("true");
    viewport.scrollLeft = 0;
    fireEvent.scroll(viewport);
    expect(viewport.dataset.scrollX).toBe("false");
    Object.defineProperty(viewport, "clientHeight", {
      configurable: true,
      value: 400,
    });
    viewport.scrollTop = 100;
    fireEvent.scroll(viewport);
    expect(viewport.dataset.scrollBottom).toBe("false");
    viewport.scrollTop = 320;
    fireEvent.scroll(viewport);
    expect(viewport.dataset.scrollBottom).toBe("true");
  });

  it("hides the first-guess placeholder after a terminal empty session", () => {
    render(
      <SingleGuessHistory
        session={{ ...session([]), status: "won" }}
        visibleFields={[]}
        guessCompletedElapsedMs={[]}
        loading={false}
        message=""
      />,
    );

    const viewport = screen.getByRole("region", { name: "猜测记录" });
    expect(viewport.querySelector(".empty-state")).toBeNull();
    expect(screen.queryByText("等待第一次猜测")).toBeNull();
  });

  it("keeps the final correct guess clear and locks the won history to the bottom", () => {
    const { rerender } = render(
      <SingleGuessHistory
        session={session([reimuGuess, correctGuess])}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000, 9_000]}
        loading={false}
        message=""
      />,
    );
    const viewport = screen.getByRole("region", { name: "猜测记录" });
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 720,
    });

    rerender(
      <SingleGuessHistory
        session={wonHistorySession}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000, 9_000]}
        loading={false}
        message=""
      />,
    );

    expect(viewport.dataset.result).toBe("won");
    expect(viewport.dataset.scrollBottom).toBe("true");
    expect(viewport.dataset.scrollLocked).toBe("true");
    expect(viewport.scrollTop).toBe(720);

    const rows = within(
      viewport.querySelector("tbody") as HTMLElement,
    ).getAllByRole("row");
    expect(rows[0].classList.contains("guess-history-obscured")).toBe(true);
    expect(rows[1].classList.contains("guess-correct-row")).toBe(true);
    expect(rows[1].classList.contains("guess-history-obscured")).toBe(false);

    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    expect(viewport.scrollTop).toBe(720);
  });

  it("keeps the final lost row clear and locks the history to the bottom", () => {
    const { rerender } = render(
      <SingleGuessHistory
        session={session([reimuGuess, timeoutGuess])}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000, 12_000]}
        loading={false}
        message=""
      />,
    );
    const viewport = screen.getByRole("region", { name: "猜测记录" });
    Object.defineProperty(viewport, "scrollHeight", {
      configurable: true,
      value: 720,
    });

    rerender(
      <SingleGuessHistory
        session={lostHistorySession}
        visibleFields={[]}
        guessCompletedElapsedMs={[4_000, 12_000]}
        loading={false}
        message=""
      />,
    );

    expect(viewport.dataset.result).toBe("lost");
    expect(viewport.dataset.completed).toBe("true");
    expect(viewport.dataset.scrollBottom).toBe("true");
    expect(viewport.dataset.scrollLocked).toBe("true");
    expect(viewport.scrollTop).toBe(720);

    const rows = within(
      viewport.querySelector("tbody") as HTMLElement,
    ).getAllByRole("row");
    expect(rows[0].classList.contains("guess-history-obscured")).toBe(true);
    expect(rows[1].classList.contains("guess-final-row")).toBe(true);
    expect(rows[1].classList.contains("guess-correct-row")).toBe(false);

    viewport.scrollTop = 120;
    fireEvent.scroll(viewport);
    expect(viewport.scrollTop).toBe(720);
  });
});
