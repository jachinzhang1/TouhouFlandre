import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MemberScoreStrip } from "./MemberScoreStrip";

describe("MemberScoreStrip", () => {
  it("sorts by seat and renders N-player states by memberId", () => {
    render(
      <MemberScoreStrip
        viewerMemberId="self"
        winnerMemberId="winner"
        members={[
          {
            memberId: "winner",
            seat: 3,
            displayName: "Winner",
            status: "left",
            ready: false,
          },
          {
            memberId: "self",
            seat: 1,
            displayName: "Self",
            status: "connected",
            ready: false,
          },
          {
            memberId: "offline",
            seat: 2,
            displayName: "Offline",
            status: "disconnected",
            ready: false,
          },
        ]}
        scores={[
          { memberId: "offline", seat: 2, score: 1 },
          { memberId: "winner", seat: 3, score: 2 },
          { memberId: "self", seat: 1, score: 0 },
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "Self(我)0",
      "Offline(P2)1离线",
      "Winner(P3)2胜离开",
    ]);
  });

  it("marks eliminated players with the elimination treatment", () => {
    render(
      <MemberScoreStrip
        members={[
          {
            memberId: "out",
            seat: 1,
            displayName: "Out",
            status: "connected",
            ready: false,
          },
        ]}
        scores={[
          {
            memberId: "out",
            seat: 1,
            score: 4,
            status: "eliminated",
            eliminatedRound: 2,
          },
        ]}
      />,
    );
    const item = screen.getByRole("listitem");
    expect(item.className).toContain("bg-vermilion");
    expect(item.textContent).toContain("已淘汰");
    expect(item.querySelector("strong")?.className).toContain("text-white");
  });
});
