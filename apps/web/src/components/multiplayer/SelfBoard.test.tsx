import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GuessResult } from "@touhouflandre/shared";
import { SelfBoard } from "./SelfBoard";

describe("SelfBoard", () => {
  it("renders a timeout as a status rather than a character guess", () => {
    const timeout: GuessResult = {
      kind: "timeout",
      guessId: "timeout-1",
      guessName: "超时空过",
      isCorrect: false,
      feedback: [],
    };

    render(<SelfBoard guesses={[timeout]} maxGuesses={8} playing />);

    expect(screen.getByRole("rowheader", { name: "超时跳过" })).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("distinguishes an equivalent winning guess from an exact match", () => {
    const guess: GuessResult = {
      guessId: "reimu_hakurei",
      guessName: "博丽灵梦",
      isCorrect: true,
      matchKind: "equivalent",
      feedback: [],
    };
    const view = render(
      <SelfBoard guesses={[guess]} fields={[]} playing={false} />,
    );
    expect(
      screen.getByRole("rowheader", { name: /博丽灵梦.*等价命中/ }),
    ).toBeTruthy();
    view.rerender(
      <SelfBoard
        guesses={[{ ...guess, matchKind: "exact" }]}
        fields={[]}
        playing={false}
      />,
    );
    expect(screen.getByRole("rowheader", { name: /博丽灵梦/ })).toBeTruthy();
    expect(screen.queryByText("等价命中")).toBeNull();
  });
});
