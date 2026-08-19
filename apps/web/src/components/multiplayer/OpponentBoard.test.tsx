// OpponentBoard 安全断言：复用单人棋盘台账，列标签位于底部表尾；
// 行内永不含角色名/值，匿名状态仍有可访问名称。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpponentBoard } from "./OpponentBoard";
import type { components } from "../../generated/api";

const row = (statuses: string[]): components["schemas"]["OpponentRow"] => ({
  index: 1,
  statuses: statuses as components["schemas"]["FeedbackStatus"][],
});

describe("OpponentBoard", () => {
  it("渲染颜色块且不含角色名/值；表头列标签出现一次", () => {
    const { container } = render(
      <OpponentBoard
        rows={[row(["exact", "partial", "miss", "higher", "lower", "unknown"])]}
      />,
    );
    // 6 个色块（匿名行 role=img）
    expect(container.querySelectorAll('span[role="img"]')).toHaveLength(6);
    // aria-label 只携带状态名（无障碍，08 §10.4）
    const labels = Array.from(
      container.querySelectorAll('span[role="img"]'),
    ).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["命中", "部分", "未中", "更高", "更低", "未知"]);
    const compactCells = Array.from(
      container.querySelectorAll(".match-feedback-compact"),
    );
    expect(compactCells).toHaveLength(6);
    expect(
      compactCells.map((cell) =>
        cell.querySelector("svg")?.getAttribute("class"),
      ),
    ).toEqual([
      "lucide lucide-check",
      "lucide lucide-check",
      "lucide lucide-x",
      "lucide lucide-chevrons-up",
      "lucide lucide-chevrons-down",
      "feedback-question-mark-icon",
    ]);
    const partialIcon = compactCells[1]?.querySelector(
      ".feedback-slashed-check-icon",
    );
    expect(partialIcon?.querySelector(".lucide-check")).toBeTruthy();
    const slash = partialIcon?.querySelector<SVGElement>(
      ".feedback-check-slash-overlay",
    );
    const slashLine = slash?.querySelector("line");
    expect(slash).toBeTruthy();
    expect(slashLine?.getAttribute("x1")).toBe("12");
    expect(slashLine?.getAttribute("y1")).toBe("7");
    expect(slashLine?.getAttribute("x2")).toBe("18");
    expect(slashLine?.getAttribute("y2")).toBe("13");
    expect(slashLine?.getAttribute("stroke-width")).toBe("2.4");
    expect(slashLine?.getAttribute("stroke-linecap")).toBe("round");
    expect(screen.queryByText("图例")).toBeNull();
    for (const cell of compactCells) expect(cell.textContent).toBe("");
    // 单人棋盘样式将列标签固定在表尾。
    for (const header of [
      "初登场作品",
      "初登场年份",
      "种族",
      "阵营",
      "地点",
      "头发颜色",
    ]) {
      const matches =
        container.textContent?.match(new RegExp(header, "g")) ?? [];
      expect(matches.length).toBe(1);
    }
    // 敏感性值绝不出现（角色名/具体值）
    const text = container.textContent ?? "";
    expect(text).not.toContain("灵梦");
    expect(text).not.toContain("幻想乡");
    expect(text).not.toContain("1996");
  });

  it("无猜测时显示等待提示", () => {
    render(<OpponentBoard rows={[]} />);
    expect(screen.getByText(/等待对方猜测/)).toBeTruthy();
  });

  it("可展示传入的对手玩家名和房间编号", () => {
    render(<OpponentBoard title="琪露诺(P2)" rows={[]} />);
    expect(screen.getByRole("heading", { name: "琪露诺(P2)" })).toBeTruthy();
  });

  it("按固定属性顺序展示置换后的对手状态", () => {
    const { container } = render(
      <OpponentBoard
        fieldOrder={[
          "species",
          "firstAppearance",
          "affiliations",
          "releaseYear",
          "locations",
          "hairColors",
        ]}
        rows={[row(["miss", "exact", "partial", "lower", "miss", "unknown"])]}
      />,
    );

    const headers = Array.from(container.querySelectorAll("tfoot th")).map(
      (header) => header.textContent,
    );
    expect(headers).toEqual([
      "角色",
      "初登场作品",
      "初登场年份",
      "种族",
      "阵营",
      "地点",
      "头发颜色",
    ]);
    const labels = Array.from(
      container.querySelectorAll('span[role="img"]'),
    ).map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual(["命中", "更低", "未中", "部分", "未中", "未知"]);
    expect(screen.getByText("对手棋盘")).toBeTruthy();
    expect(
      screen.getByText("仅显示反馈状态，具体角色与属性值将在局末揭示。"),
    ).toBeTruthy();
  });
});
