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
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "返回大厅" }),
    );

    expect(screen.getByText("Self(我)")).toBeTruthy();
    expect(screen.getByText("Two(P2)")).toBeTruthy();
    expect(screen.getByText("Three(P3)")).toBeTruthy();
    expect(screen.getByText("第 1 场 · BO3 · 正常完赛")).toBeTruthy();
    expect(screen.getByText("待确认：Two")).toBeTruthy();
    const confirmed = screen.getByRole("button", { name: "已确认 2/3" });
    expect((confirmed as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirmed);
    expect(rematch).not.toHaveBeenCalled();
  });

  it("shows shared first only for viewers ranked first", () => {
    const sharedFirstResult: MatchEndedPayload = {
      ...result,
      viewerResult: "draw",
      winnerMemberId: null,
      ranking: [
        { memberId: "self", seat: 1, rank: 1, score: 6, status: "active" },
        { memberId: "two", seat: 2, rank: 1, score: 6, status: "active" },
        {
          memberId: "three",
          seat: 3,
          rank: 3,
          score: 2,
          status: "eliminated",
          eliminatedRound: 1,
        },
      ],
      results: [
        { memberId: "self", seat: 1, result: "draw" },
        { memberId: "two", seat: 2, result: "draw" },
        { memberId: "three", seat: 3, result: "loss" },
      ],
    };

    const { container, rerender } = render(
      <MatchResultOverlay
        result={sharedFirstResult}
        memberId="self"
        members={members}
        format="bo3"
        rematchReady={[]}
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    const sharedFirstTitle = screen.getByRole("heading", {
      name: "并列第一",
    });
    expect(
      sharedFirstTitle
        .closest(".match-settlement-summary")
        ?.getAttribute("data-highlighted"),
    ).toBe("true");
    expect(screen.getAllByText("#1")).toHaveLength(2);
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("Self(我)").closest("li")?.dataset.rank).toBe("1");
    expect(screen.getByText("Two(P2)").closest("li")?.dataset.rank).toBe("1");
    expect(screen.getByText("第 1 局淘汰")).toBeTruthy();
    expect(screen.getByText("第 1 场 · 积分淘汰 · 正常完赛")).toBeTruthy();
    expect(screen.getByRole("button", { name: "确认再来一局" })).toBeTruthy();
    expect(container.querySelector("svg")?.classList).toContain(
      "match-result-trophy-highlighted",
    );

    rerender(
      <MatchResultOverlay
        result={{ ...sharedFirstResult, viewerResult: "loss" }}
        memberId="three"
        members={members}
        format="bo3"
        rematchReady={[]}
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    );

    expect(
      screen
        .getByRole("heading", { name: "对局失利" })
        .closest(".match-settlement-summary")
        ?.getAttribute("data-highlighted"),
    ).toBe("false");
    expect(container.querySelector("svg")?.classList).not.toContain(
      "match-result-trophy-highlighted",
    );
    expect(screen.queryByRole("heading", { name: "并列第一" })).toBeNull();
  });
});
