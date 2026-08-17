import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { GuessResult } from "@touhouflandre/shared";
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
    expect(row?.querySelector(".avatar")).toBeNull();
    expect(row?.textContent).not.toContain("超超时空过");
  });
});
