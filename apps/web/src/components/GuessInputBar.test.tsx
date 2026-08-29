// 底部搜索条键盘导航（↑↓ 移动指针、Enter 提交高亮项；默认指向第一项）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuessInputBar } from "./GuessInputBar";

vi.mock("../hooks/useCharacterSearch", () => {
  // 按 query 缓存稳定引用（真实 hook 的 results 是 state，引用跨渲染稳定，
  // mock 若每次返回新数组会误触组件内「结果变化回第一项」的重置 effect）。
  const all = [
    {
      id: "reimu_hakurei",
      name: "博丽灵梦",
      avatarUrl: "/c.png",
      firstAppearance: { workTitle: "东方灵异传" },
    },
    {
      id: "byakuren_hijiri",
      name: "圣白莲",
      avatarUrl: "/c.png",
      firstAppearance: { workTitle: "东方星莲船" },
    },
  ];
  const byQuery = new Map<string, typeof all>();
  return {
    useCharacterSearch: (query: string) => {
      if (!byQuery.has(query)) {
        byQuery.set(
          query,
          query === "" ? [] : query === "白" ? all : all.slice(0, 1),
        );
      }
      return { results: byQuery.get(query), loading: query === "", error: "" };
    },
  };
});

describe("GuessInputBar", () => {
  const onGuess = vi.fn(async () => true);
  const searchContext = {
    kind: "multiplayer-match" as const,
    roomId: "room-1",
    matchIndex: 0,
  };

  beforeEach(() => {
    onGuess.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认高亮第一项，下键移动高亮，回车提交高亮项", async () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "白" } });

    const buttons = await waitFor(() =>
      screen
        .getAllByRole("button")
        .filter((b) => b.id.startsWith("suggestion-")),
    );
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const isHighlighted = (el: HTMLElement) =>
      el.className.includes("bg-vermilion-soft") &&
      !el.className.includes("hover:");
    // 默认第一项高亮（非高亮项仅带 hover: 前缀）
    expect(isHighlighted(buttons[0])).toBe(true);
    expect(isHighlighted(buttons[1])).toBe(false);
    // 下键 → 高亮移到第二项
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const fresh = screen
      .getAllByRole("button")
      .filter((b) => b.id.startsWith("suggestion-"));

    expect(isHighlighted(buttons[1])).toBe(true);
    expect(isHighlighted(buttons[0])).toBe(false);
    // 回车 → 提交第二项（圣白莲）并清空输入
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).toHaveBeenCalledWith("byakuren_hijiri");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("搜索角色") as HTMLInputElement).value,
      ).toBe(""),
    );
  });

  it("在搜索区域展示索引加载状态", () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain(
      "正在加载搜索索引",
    );
  });

  it("直接回车提交默认第一项", async () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() =>
      expect(
        screen.getAllByRole("button").some((b) => b.id === "suggestion-0"),
      ).toBe(true),
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).toHaveBeenCalledWith("reimu_hakurei");
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""));
  });

  it("restores focus after Enter submits a suggestion", async () => {
    const handleGuess = vi.fn();
    render(
      <GuessInputBar
        onGuess={async (guessId) => {
          handleGuess(guessId);
          (document.activeElement as HTMLElement | null)?.blur();
          await Promise.resolve();
          return true;
        }}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button")
          .some((button) => button.id === "suggestion-0"),
      ).toBe(true),
    );

    fireEvent.keyDown(input, { key: "Enter" });

    expect(handleGuess).toHaveBeenCalledWith("reimu_hakurei");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("提交失败时保留查询内容以便重试", async () => {
    const rejectGuess = vi.fn(async () => false);
    render(
      <GuessInputBar
        onGuess={rejectGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /博丽灵梦/ })).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /博丽灵梦/ }));

    await waitFor(() =>
      expect(rejectGuess).toHaveBeenCalledWith("reimu_hakurei"),
    );
    expect((input as HTMLInputElement).value).toBe("灵梦");
  });

  it("搜索路由切换后仍过滤已猜角色并阻止重复提交", async () => {
    const guessed = new Set(["reimu_hakurei"]);
    const { rerender } = render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={{ ...searchContext, roomId: "local-room" }}
        guessedIds={guessed}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "白" } });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /圣白莲/ })).toBeTruthy(),
    );
    expect(screen.queryByRole("button", { name: /博丽灵梦/ })).toBeNull();

    rerender(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={{ ...searchContext, roomId: "remote-room" }}
        guessedIds={guessed}
      />,
    );
    expect(screen.queryByRole("button", { name: /博丽灵梦/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /圣白莲/ }));
    await waitFor(() =>
      expect(onGuess).toHaveBeenCalledWith("byakuren_hijiri"),
    );

    rerender(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={{ ...searchContext, roomId: "remote-room" }}
        guessedIds={new Set(["reimu_hakurei", "byakuren_hijiri"])}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索角色"), {
      target: { value: "白" },
    });
    await waitFor(() =>
      expect(
        screen
          .queryAllByRole("button")
          .filter((button) => button.id.startsWith("suggestion-")),
      ).toHaveLength(0),
    );
    expect(onGuess).toHaveBeenCalledTimes(1);
  });

  it("在多人底部输入栏展示共用反馈图例", () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看图例" }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("feedback-legend-tooltip-above");
    expect(screen.getByText("属性值缺失或无法判断，若遇到请反馈")).toBeTruthy();
    expect(tooltip.querySelector(".feedback-question-mark-icon")).toBeTruthy();
    expect(tooltip.querySelectorAll(".lucide-x")).toHaveLength(1);

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("禁用后清空搜索并展示权威只读状态", async () => {
    const { rerender } = render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索角色"), {
      target: { value: "灵梦" },
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /博丽灵梦/ })).toBeTruthy(),
    );

    rerender(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
        disabled
        statusMessage="你已放弃本局"
      />,
    );

    expect(
      (screen.getByLabelText("搜索角色") as HTMLInputElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("搜索角色") as HTMLInputElement).value).toBe(
      "",
    );
    expect(screen.getByRole("status").textContent).toContain("你已放弃本局");
    expect(screen.queryByRole("button", { name: /博丽灵梦/ })).toBeNull();
  });
});
