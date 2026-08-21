// 底部搜索条键盘导航（↑↓ 移动指针、Enter 提交高亮项；默认指向第一项）。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { GuessInputBar } from "./GuessInputBar";

vi.mock("../../hooks/useCharacterSearch", () => {
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
  const onGuess = vi.fn();

  beforeEach(() => {
    onGuess.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes a visible and accessible guess channel label", () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );

    expect(screen.getByText("猜测", { selector: "strong" })).toBeTruthy();
    expect(screen.getByText("选择角色后提交")).toBeTruthy();
    expect(screen.getByRole("form", { name: "猜测" })).toBeTruthy();
  });

  it("uses arrows and Enter to select, then submits explicitly", async () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "白" } });

    const options = await waitFor(() => screen.getAllByRole("option"));
    const isHighlighted = (element: HTMLElement) =>
      element.getAttribute("aria-selected") === "true";
    expect(isHighlighted(options[0])).toBe(true);
    expect(isHighlighted(options[1])).toBe(false);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(isHighlighted(screen.getAllByRole("option")[1])).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onGuess).not.toHaveBeenCalled();
    expect((input as HTMLInputElement).value).toBe("圣白莲");
    const submit = screen.getByRole("button", { name: "提交猜测" });
    expect(submit.dataset.paperVariant).toBe("tinted");
    expect(submit.dataset.paperFolded).toBe("false");
    fireEvent.click(submit);

    expect(onGuess).toHaveBeenCalledWith("byakuren_hijiri");
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("selects the default first result before submission", async () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色");
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onGuess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "提交猜测" }));
    expect(onGuess).toHaveBeenCalledWith("reimu_hakurei");
  });

  it("restores focus after Enter submits a suggestion that temporarily disables the bar", async () => {
    const handleGuess = vi.fn();
    function Harness() {
      const [disabled, setDisabled] = useState(false);
      return (
        <GuessInputBar
          onGuess={async (guessId) => {
            handleGuess(guessId);
            setDisabled(true);
            (document.activeElement as HTMLElement | null)?.blur();
            await Promise.resolve();
            setDisabled(false);
          }}
          catalogVersion="v1"
          guessedIds={new Set()}
          disabled={disabled}
        />
      );
    }

    render(<Harness />);
    const input = screen.getByRole("combobox");
    input.focus();
    fireEvent.change(input, { target: { value: "灵梦" } });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /博丽灵梦/ })).toBeTruthy(),
    );

    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLInputElement).value).toBe("博丽灵梦");
    fireEvent.submit(input.closest("form")!);

    expect(handleGuess).toHaveBeenCalledWith("reimu_hakurei");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("在多人底部输入栏展示共用反馈图例", () => {
    render(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看反馈图例" }));

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
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );
    fireEvent.change(screen.getByLabelText("搜索角色"), {
      target: { value: "灵梦" },
    });
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /博丽灵梦/ })).toBeTruthy(),
    );

    rerender(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
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

  it("preserves a typed draft during transient reconnect disablement", () => {
    const { rerender } = render(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        guessedIds={new Set()}
      />,
    );
    const input = screen.getByLabelText("搜索角色") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "灵梦" } });

    rerender(
      <GuessInputBar
        onGuess={onGuess}
        catalogVersion="v1"
        disabled
        guessedIds={new Set()}
        preserveDraftWhenDisabled
        statusMessage="实时同步恢复后可继续猜测"
        statusTone="warning"
      />,
    );

    expect(input.value).toBe("灵梦");
    expect(screen.getAllByText("实时同步恢复后可继续猜测")).toHaveLength(2);
    const status = screen.getByRole("status");
    expect(status.dataset.paperTone).toBe("warning");
    expect(status.dataset.paperVariant).toBe("tinted");
  });
});
