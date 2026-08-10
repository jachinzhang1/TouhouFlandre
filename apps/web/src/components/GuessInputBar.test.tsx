// 底部搜索条键盘导航（↑↓ 移动指针、Enter 提交高亮项；默认指向第一项）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GuessInputBar } from "./GuessInputBar";

vi.mock("../hooks/useCharacterSearch", () => {
  // 与真实 searchText 语义一致：灵梦别名「红白」使 "白" 命中两项；
  // 按 query 缓存稳定引用（真实 hook 的 results 是 state，引用跨渲染稳定，
  // mock 若每次返回新数组会误触组件内「结果变化回第一项」的重置 effect）。
  const all = [
    { id: "reimu_hakurei", name: "博丽灵梦", avatarUrl: "/c.png", firstAppearance: { workTitle: "东方灵异传" }, searchText: "博丽灵梦红白bllm" },
    { id: "byakuren_hijiri", name: "圣白莲", avatarUrl: "/c.png", firstAppearance: { workTitle: "东方星莲船" }, searchText: "圣白莲byakurenhijiri" },
  ];
  const byQuery = new Map<string, typeof all>();
  return {
    useCharacterSearch: (query: string) => {
      if (!byQuery.has(query)) {
        byQuery.set(query, query === "" ? [] : all.filter((c) => c.searchText.includes(query)));
      }
      return { results: byQuery.get(query), loading: query === "", error: "" };
    },
  };
});

describe("GuessInputBar", () => {
  const onGuess = vi.fn();

  beforeEach(() => {
    onGuess.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("默认高亮第一项，下键移动高亮，回车提交高亮项", async () => {
    render(<GuessInputBar onGuess={onGuess} guessedIds={new Set()} />);
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "白" } });

    const buttons = await waitFor(() => screen.getAllByRole("button").filter((b) => b.id.startsWith("suggestion-")));
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    const isHighlighted = (el: HTMLElement) =>
      el.className.includes("bg-vermilion-soft") && !el.className.includes("hover:");
    // 默认第一项高亮（非高亮项仅带 hover: 前缀）
    expect(isHighlighted(buttons[0])).toBe(true);
    expect(isHighlighted(buttons[1])).toBe(false);
    // 下键 → 高亮移到第二项
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const fresh = screen.getAllByRole("button").filter((b) => b.id.startsWith("suggestion-"));

    expect(isHighlighted(buttons[1])).toBe(true);
    expect(isHighlighted(buttons[0])).toBe(false);
    // 回车 → 提交第二项（圣白莲）并清空输入
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).toHaveBeenCalledWith("byakuren_hijiri");
    expect((screen.getByLabelText("搜索角色") as HTMLInputElement).value).toBe("");
  });

  it("直接回车提交默认第一项", async () => {
    render(<GuessInputBar onGuess={onGuess} guessedIds={new Set()} />);
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() => expect(screen.getAllByRole("button").some((b) => b.id === "suggestion-0")).toBe(true));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).toHaveBeenCalledWith("reimu_hakurei");
  });

  it("在多人底部输入栏展示共用反馈图例", () => {
    render(<GuessInputBar onGuess={onGuess} guessedIds={new Set()} />);

    fireEvent.click(screen.getByRole("button", { name: "查看图例" }));

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip.className).toContain("feedback-legend-tooltip-above");
    expect(screen.getByText("属性值缺失或无法判断，若遇到请反馈")).toBeTruthy();
    expect(tooltip.querySelector(".feedback-question-mark-icon")).toBeTruthy();
    expect(tooltip.querySelectorAll(".lucide-x")).toHaveLength(1);

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
