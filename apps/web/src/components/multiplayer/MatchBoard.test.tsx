import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import { MatchBoard } from "./MatchBoard";

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

describe("MatchBoard", () => {
  beforeEach(() => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    });
  });

  it("shows whether the current placement round can eliminate players", () => {
    render(
      <MatchBoard
        format="bo3"
        match={{
          matchIndex: 0,
          targetWins: 2,
          roundIndex: 1,
          maxRounds: 6,
          scoringMode: "placement",
          rosterSize: 4,
          scores: members.map((member, index) => ({
            memberId: member.memberId,
            seat: member.seat,
            score: 4 - index,
            status: "active" as const,
            bestRoundScore: 4 - index,
          })),
          rematchReady: [],
          catalogVersion: "v1",
        }}
        round={
          {
            status: "playing",
            startsAt: "2099-08-15T00:00:00Z",
            deadline: "2099-08-15T00:05:00Z",
            maxGuesses: 8,
            self: { guesses: [] },
            opponents: [],
          } as never
        }
        memberId="self"
        members={members}
        roundResult={null}
        fields={[]}
      />,
    );

    expect(screen.getByText("本局不淘汰选手")).toBeTruthy();

    render(
      <MatchBoard
        format="bo3"
        match={{
          matchIndex: 0,
          targetWins: 2,
          roundIndex: 2,
          maxRounds: 6,
          scoringMode: "placement",
          rosterSize: 4,
          scores: members.map((member, index) => ({
            memberId: member.memberId,
            seat: member.seat,
            score: 4 - index,
            status: "active" as const,
            bestRoundScore: 4 - index,
          })),
          rematchReady: [],
          catalogVersion: "v1",
        }}
        round={
          {
            status: "playing",
            startsAt: "2099-08-15T00:00:00Z",
            deadline: "2099-08-15T00:05:00Z",
            maxGuesses: 8,
            self: { guesses: [] },
            opponents: [],
          } as never
        }
        memberId="self"
        members={members}
        roundResult={null}
        fields={[]}
      />,
    );

    expect(screen.getByText("本局末位淘汰")).toBeTruthy();
  });

  it("marks eliminated historical boards in red", () => {
    const result: RoundEndedPayload = {
      matchIndex: 0,
      roundIndex: 2,
      winnerMemberId: "self",
      answer: {
        id: "answer",
        name: "Answer",
        avatarUrl: "",
        workId: "work",
        workTitle: "Work",
        workCode: "TH01",
      },
      boards: [
        {
          memberId: "self",
          seat: 1,
          guesses: [],
        },
        {
          memberId: "two",
          seat: 2,
          guesses: [],
        },
        {
          memberId: "three",
          seat: 3,
          guesses: [],
        },
      ],
      scores: members.map((member, index) => ({
        memberId: member.memberId,
        seat: member.seat,
        score: 4 - index,
        status: "active" as const,
        bestRoundScore: 4 - index,
      })),
      results: members.map((member, index) => ({
        memberId: member.memberId,
        seat: member.seat,
        result: index === 0 ? "win" : "loss",
      })),
      eliminatedMemberIds: ["two"],
      placements: [
        {
          memberId: "self",
          seat: 1,
          status: "correct",
          pointsAwarded: 3,
        },
        {
          memberId: "two",
          seat: 2,
          status: "exhausted",
          pointsAwarded: 0,
        },
        {
          memberId: "three",
          seat: 3,
          status: "forfeited",
          pointsAwarded: 1,
        },
      ],
      viewerResult: "win",
      nextStartsAt: "2099-08-15T00:10:00Z",
    };

    render(
      <MatchBoard
        format="bo3"
        match={{
          matchIndex: 0,
          targetWins: 2,
          roundIndex: 2,
          maxRounds: 6,
          scoringMode: "placement",
          rosterSize: 4,
          scores: result.scores,
          rematchReady: [],
          catalogVersion: "v1",
        }}
        round={null}
        memberId="self"
        members={members}
        roundResult={result}
        fields={[]}
      />,
    );

    expect(screen.getAllByText("淘汰").length).toBeGreaterThan(0);
    expect(screen.getAllByText("胜利").length).toBeGreaterThan(0);
  });
  it("toggles the mobile match details without hiding the round summary", () => {
    render(
      <MatchBoard
        format="bo3"
        match={{
          matchIndex: 0,
          targetWins: 2,
          roundIndex: 2,
          maxRounds: 6,
          scoringMode: "wins",
          rosterSize: 3,
          scores: members.map((member, index) => ({
            memberId: member.memberId,
            seat: member.seat,
            score: index,
            status: "active" as const,
            bestRoundScore: index,
          })),
          rematchReady: [],
          catalogVersion: "v1",
        }}
        round={
          {
            status: "playing",
            startsAt: "2099-08-15T00:00:00Z",
            deadline: "2099-08-15T00:05:00Z",
            maxGuesses: 8,
            self: { guesses: [] },
            opponents: [],
          } as never
        }
        memberId="self"
        members={members}
        roundResult={null}
        roundActions={<span>Actions</span>}
        fields={[]}
      />,
    );

    const scores = screen.getByRole("list", { name: "当前积分" });
    expect(scores).toBeTruthy();
    const timer = screen.getByRole("timer", { name: /本局剩余/ });
    expect(timer.textContent).toContain(":");

    expect(screen.getByText("第 2 局")).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "展开对局信息" });
    const details = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    );
    expect(details?.contains(scores)).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(details?.dataset.open).toBe("false");

    fireEvent.click(toggle);

    expect(
      screen
        .getByRole("button", { name: "收起对局信息" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(details?.dataset.open).toBe("true");
  });
});
