import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoardBrowser,
  BoardViewport,
  MatchCountdownBand,
  MatchFinishedBand,
  MatchSummaryBar,
  MultiplayerBottomDockProvider,
  MultiplayerMatchFrame,
} from ".";

describe("multiplayer match framework", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stacks persistent and optional action docks through the shared host", async () => {
    const view = render(
      <MultiplayerBottomDockProvider
        persistentDock={<div data-testid="persistent-dock">chat</div>}
      >
        <MultiplayerMatchFrame
          bottomDock={<div data-testid="action-dock">guess</div>}
        >
          <div>board</div>
        </MultiplayerMatchFrame>
      </MultiplayerBottomDockProvider>,
    );

    const persistent = screen.getByTestId("persistent-dock");
    const action = await screen.findByTestId("action-dock");
    const persistentSlot = persistent.closest(
      "[data-multiplayer-persistent-dock]",
    );
    const actionSlot = action.closest("[data-multiplayer-action-dock]");
    const host = persistent.closest("[data-multiplayer-bottom-dock]");
    expect(persistentSlot).not.toBeNull();
    expect(actionSlot).not.toBeNull();
    expect(host?.className).toContain("bg-paper/95");
    expect(host?.className).toContain("border-t");
    expect(persistentSlot?.className).not.toContain("bg-paper");
    expect(persistentSlot?.className).not.toContain("border-t");
    expect(
      persistentSlot!.compareDocumentPosition(actionSlot!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    view.rerender(
      <MultiplayerBottomDockProvider
        persistentDock={<div data-testid="persistent-dock">chat</div>}
      >
        <MultiplayerMatchFrame>
          <div>board</div>
        </MultiplayerMatchFrame>
      </MultiplayerBottomDockProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("action-dock")).toBeNull());
    expect(
      document.querySelector("[data-multiplayer-action-dock]")?.childNodes,
    ).toHaveLength(0);
  });

  it("supports either dock slot independently and collapses an empty host", async () => {
    const view = render(
      <MultiplayerBottomDockProvider>
        <MultiplayerMatchFrame
          bottomDock={<div data-testid="action-only">guess</div>}
        >
          <div>board</div>
        </MultiplayerMatchFrame>
      </MultiplayerBottomDockProvider>,
    );
    expect(await screen.findByTestId("action-only")).not.toBeNull();
    expect(
      document.querySelector("[data-multiplayer-persistent-dock]"),
    ).toBeNull();

    view.rerender(
      <MultiplayerBottomDockProvider>
        <div>board</div>
      </MultiplayerBottomDockProvider>,
    );
    await waitFor(() => expect(screen.queryByTestId("action-only")).toBeNull());
    expect(document.querySelector("[data-multiplayer-bottom-dock]")).toBeNull();
    expect(
      document.querySelector("[data-multiplayer-bottom-dock-spacer]"),
    ).toBeNull();
  });

  it("reserves the measured collapsed dock height in page flow", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const height = this.hasAttribute("data-multiplayer-bottom-dock")
          ? 84
          : 0;
        return {
          x: 0,
          y: 0,
          top: 0,
          right: 0,
          bottom: height,
          left: 0,
          width: 0,
          height,
          toJSON: () => ({}),
        };
      },
    );

    render(
      <MultiplayerBottomDockProvider persistentDock={<div>chat</div>}>
        <div>board</div>
      </MultiplayerBottomDockProvider>,
    );

    await waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          "[data-multiplayer-bottom-dock-spacer]",
        )?.style.height,
      ).toBe("84px"),
    );
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
