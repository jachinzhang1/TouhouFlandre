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

    const options = await screen.findAllByRole("option");
    expect(options.length).toBeGreaterThanOrEqual(2);
    const isHighlighted = (element: HTMLElement) =>
      element.getAttribute("aria-selected") === "true";
    // 默认第一项高亮（非高亮项仅带 hover: 前缀）
    expect(isHighlighted(options[0])).toBe(true);
    expect(isHighlighted(options[1])).toBe(false);
    // 下键 → 高亮移到第二项
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const fresh = screen.getAllByRole("option");

    expect(isHighlighted(fresh[1])).toBe(true);
    expect(isHighlighted(fresh[0])).toBe(false);
    // 回车 → 提交第二项（圣白莲）并清空输入
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).toHaveBeenCalledWith("byakuren_hijiri");
    await waitFor(() =>
      expect(
        (screen.getByLabelText("搜索角色") as HTMLInputElement).value,
      ).toBe(""),
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
    await screen.findByRole("option", { name: /博丽灵梦/ });
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
    await screen.findByRole("option", { name: /博丽灵梦/ });

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
    await screen.findByRole("option", { name: /博丽灵梦/ });

    fireEvent.click(screen.getByRole("option", { name: /博丽灵梦/ }));

    await waitFor(() =>
      expect(rejectGuess).toHaveBeenCalledWith("reimu_hakurei"),
    );
    expect((input as HTMLInputElement).value).toBe("灵梦");
  });

  it("在多人底部输入栏展示共用反馈图例", () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        searchContext={searchContext}
        guessedIds={new Set()}
      />,
    );

    expect(screen.getByRole("list", { name: "反馈图例" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(6);
    expect(screen.getByText("未知，遇到请反馈")).toBeTruthy();

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
    await screen.findByRole("option", { name: /博丽灵梦/ });

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
    expect(screen.queryByRole("option", { name: /博丽灵梦/ })).toBeNull();
  });
});
