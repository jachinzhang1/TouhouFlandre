import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { MatchEndedPayload } from "@touhouflandre/shared";
import { MatchResultOverlay } from "./MatchResultOverlay";

const members = [
  {
    memberId: "self",
    seat: 1,
    displayName: "Self",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "two",
    seat: 2,
    displayName: "Two",
    status: "connected" as const,
    ready: false,
  },
  {
    memberId: "three",
    seat: 3,
    displayName: "Three",
    status: "connected" as const,
    ready: false,
  },
];

const result: MatchEndedPayload = {
  matchIndex: 0,
  viewerResult: "win",
  winnerMemberId: "self",
  scores: [
    { memberId: "three", seat: 3, score: 0 },
    { memberId: "self", seat: 1, score: 2 },
    { memberId: "two", seat: 2, score: 1 },
  ],
  results: [
    { memberId: "three", seat: 3, result: "loss" },
    { memberId: "self", seat: 1, result: "win" },
    { memberId: "two", seat: 2, result: "loss" },
  ],
  reason: "normal",
  retentionEndsAt: "2026-08-13T12:30:00Z",
};

describe("MatchResultOverlay", () => {
  it("renders N-player scores and pending rematch members by memberId", () => {
    const rematch = vi.fn();
    render(
      <MatchResultOverlay
        result={result}
        memberId="self"
        members={members}
        format="bo3"
        rematchReady={[
          { memberId: "self", seat: 1, ready: true },
          { memberId: "two", seat: 2, ready: false },
          { memberId: "three", seat: 3, ready: true },
        ]}
        onRematch={rematch}
        onLeave={vi.fn()}
      />,
    );

    expect(screen.getByText("2 : 1 : 0")).toBeTruthy();
    expect(screen.getByText("待确认：Two")).toBeTruthy();
    const confirmed = screen.getByRole("button", { name: "已确认 2/3" });
    expect((confirmed as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmed);
    expect(rematch).not.toHaveBeenCalled();
  });
});
