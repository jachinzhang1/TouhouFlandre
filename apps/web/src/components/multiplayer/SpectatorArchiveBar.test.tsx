import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RoundEndedPayload } from "@touhouflandre/shared";
import { SpectatorArchiveBar } from "./RoomPage";

function archive(matchIndex: number, roundIndex: number): RoundEndedPayload {
  return {
    matchIndex,
    roundIndex,
    winnerMemberId: "one",
    answer: {
      id: "answer",
      name: "芙兰朵露",
      avatarUrl: "/characters/flandre.png",
      workId: "eosd",
      workTitle: "东方红魔乡",
      workCode: "eosd",
    },
    boards: [],
    scores: [{ memberId: "one", seat: 1, score: roundIndex }],
    results: [{ memberId: "one", seat: 1, result: "win" }],
  };
}

const archives = [archive(0, 1), archive(0, 2), archive(1, 1)];

describe("SpectatorArchiveBar", () => {
  it("navigates match and round layers without rendering one chip per archive", () => {
    const onSelect = vi.fn();
    render(
      <SpectatorArchiveBar
        archives={archives}
        contentId="archive-content"
        followLiveLabel="第 2 场 · 第 2 局进行中"
        selectedKey="0:2"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("navigation", { name: "复盘记录" })).toBeTruthy();
    expect(screen.getByText("第 1 场 · 1/2")).toBeTruthy();
    expect(screen.getByText("第 2 局 · 2/2")).toBeTruthy();
    expect(screen.queryByText("第 1 场 · 第 1 局")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "下一场" }));
    expect(onSelect).toHaveBeenLastCalledWith("1:1");

    fireEvent.click(screen.getByRole("button", { name: "上一局" }));
    expect(onSelect).toHaveBeenLastCalledWith("0:1");

    fireEvent.click(screen.getByRole("button", { name: "返回实时" }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(
      screen
        .getByRole("button", { name: "下一场" })
        .getAttribute("aria-controls"),
    ).toBe("archive-content");
  });

  it("announces follow-live state separately from archive selection", () => {
    const onSelect = vi.fn();
    render(
      <SpectatorArchiveBar
        archives={archives}
        contentId="archive-content"
        followLiveLabel="第 2 场 · 第 2 局进行中"
        selectedKey={null}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("status").textContent).toBe("正在跟随");
    expect(screen.getByText("第 2 场 · 第 2 局进行中")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "返回实时" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "查看所选记录" }));
    expect(onSelect).toHaveBeenCalledWith("1:1");
  });
});
