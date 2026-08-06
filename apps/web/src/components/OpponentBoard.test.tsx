// OpponentBoard 安全断言（08 §4.5/§12）：只渲染颜色，永不含名称/标签/值。
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OpponentBoard } from "./OpponentBoard";
import type { components } from "../generated/api";

const row = (statuses: string[]): components["schemas"]["OpponentRow"] => ({
  index: 1,
  statuses: statuses as components["schemas"]["FeedbackStatus"][],
});

describe("OpponentBoard", () => {
  it("渲染颜色块且不含角色名/字段标签/值", () => {
    const { container } = render(
      <OpponentBoard
        rows={[row(["exact", "partial", "miss", "higher", "lower", "unknown"])]}
      />,
    );
    // 6 个色块
    expect(container.querySelectorAll('span[role="img"]')).toHaveLength(6);
    // aria-label 只携带状态名（无障碍，08 §10.4）
    const labels = Array.from(container.querySelectorAll('span[role="img"]')).map(
      (el) => el.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["命中", "部分", "未中", "更高", "更低", "未知"]);
    // 敏感性字段绝不出现
    const text = container.textContent ?? "";
    expect(text).not.toContain("灵梦");
    expect(text).not.toContain("初登场");
    expect(text).not.toContain("种族");
    expect(text).not.toContain("幻想乡");
    // 不出现字段标签（初登场作品/头发颜色等）
    for (const forbidden of ["初登场作品", "初登场年份", "头发颜色", "阵营", "地点"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("无猜测时显示等待提示", () => {
    render(<OpponentBoard rows={[]} />);
    expect(screen.getByText(/等待对方猜测/)).toBeTruthy();
  });
});
