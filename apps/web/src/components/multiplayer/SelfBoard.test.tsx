import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_GUESS_FIELDS,
  type GuessResult,
} from "@touhouflandre/shared";
import { SelfBoard } from "./SelfBoard";

describe("SelfBoard", () => {
  it("renders timeout events as one spanning status row", () => {
    const timeout: GuessResult = {
      kind: "timeout",
      guessId: "timeout-1",
      guessName: "超时空过",
      isCorrect: false,
      feedback: [],
    };

    render(<SelfBoard guesses={[timeout]} maxGuesses={8} playing />);

    const status = screen.getByText("超时跳过");
    const row = status.closest("tr");
    expect(row?.querySelectorAll("td")).toHaveLength(1);
    expect(row?.querySelector("td")?.getAttribute("colspan")).toBe("7");
    expect(row?.querySelector(".avatar")).toBeNull();
    expect(row?.textContent).not.toContain("超超时空过");
    expect(status.closest(".multiplayer-board")).toBeTruthy();
    expect(status.closest(".multiplayer-board-paper")).toBeTruthy();
  });

  it("uses the single-player tinted feedback cell structure", () => {
    const guess: GuessResult = {
      kind: "guess",
      guessId: "reimu_hakurei",
      guessName: "博丽灵梦",
      guessAvatarUrl: "/characters/0001-博丽灵梦.png",
      isCorrect: false,
      feedback: [
        {
          field: "firstAppearance",
          label: "初登场作品",
          status: "exact",
          symbol: "O",
          displayValue: ["东方红魔乡"],
        },
      ],
    };

    const { container } = render(
      <SelfBoard
        fields={[CHARACTER_GUESS_FIELDS[0]]}
        guesses={[guess]}
        maxGuesses={8}
        playing
      />,
    );

    const cell = container.querySelector(".feedback-cell-exact");
    expect(cell?.classList.contains("paper-tinted-cell")).toBe(true);
    expect(cell?.querySelector(".feedback-exact")).toBeTruthy();
    expect(cell?.querySelector(".feedback-exact > b > svg")).toBeTruthy();
  });
});
