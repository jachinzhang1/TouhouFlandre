import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardBrowser,
  BoardViewport,
  MatchCountdownBand,
  MatchFinishedBand,
  MatchSummaryBar,
  MultiplayerMatchFrame,
} from ".";

describe("multiplayer match framework", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the shared frame and score summary without mode-specific data", () => {
    render(
      <MultiplayerMatchFrame>
        <MatchSummaryBar
          model={{
            identityLabel: "竞速 · 积分淘汰 · BO3",
            progressLabel: "第 1/3 局",
            scoreEntries: [
              {
                memberId: "one",
                seat: 1,
                displayName: "玩家一",
                score: 3,
                isViewer: true,
              },
            ],
          }}
        />
      </MultiplayerMatchFrame>,
    );

    expect(screen.getByText("竞速 · 积分淘汰 · BO3")).toBeTruthy();
    expect(screen.getByText("第 1/3 局")).toBeTruthy();
    expect(
      screen.getByRole("list", { name: "玩家积分" }).textContent,
    ).toContain("玩家一(我)3");
    expect(
      document.querySelector("[data-multiplayer-match-frame]"),
    ).not.toBeNull();
  });

  it("announces a server-timed countdown as an inline status", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
    render(
      <MatchCountdownBand targetAt="2026-08-25T00:00:05Z" label="下一局" />,
    );

    const countdown = screen.getByRole("status");
    expect(countdown.textContent).toContain("下一局将于 5 秒后开始");
    expect(countdown.classList.contains("match-countdown-band")).toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps scope and board selection controlled", () => {
    const onScopeChange = vi.fn();
    const onBoardChange = vi.fn();
    render(
      <BoardBrowser
        model={{
          ariaLabel: "棋盘导航",
          returnLabel: "返回当前局",
          currentScopeId: "current",
          selectedScopeId: "current",
          scopeLabel: "选择局次",
          scopeOptions: [
            { id: "current", label: "当前局" },
            { id: "history:1", label: "第 1 局" },
          ],
          boardLabel: "选择对手",
          selectedBoardId: "two",
          boardOptions: [
            { id: "two", label: "玩家二" },
            { id: "three", label: "玩家三" },
          ],
        }}
        onScopeChange={onScopeChange}
        onBoardChange={onBoardChange}
      />,
    );

    fireEvent.change(screen.getByLabelText("选择局次"), {
      target: { value: "history:1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一张棋盘" }));

    expect(onScopeChange).toHaveBeenCalledWith("history:1");
    expect(onBoardChange).toHaveBeenCalledWith("three");
  });

  it("renders loading, retry and inline finished states", () => {
    const retry = vi.fn();
    const view = render(
      <BoardViewport
        state={{ status: "error", message: "加载失败", onRetry: retry }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(retry).toHaveBeenCalledOnce();

    view.rerender(
      <MatchFinishedBand
        ranking={[
          {
            id: "one",
            rank: 1,
            label: "玩家一(我)",
            scoreLabel: "9 分",
            isViewer: true,
          },
        ]}
        ready={false}
        readyLabel="再来一局"
        onRematch={vi.fn()}
        onLeave={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "最终排名" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
