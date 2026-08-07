import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SiteNav } from "./SiteNav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

describe("SiteNav", () => {
  it("隐藏排行榜入口并保留其他导航项", () => {
    render(<SiteNav />);

    const navigation = screen.getByRole("navigation", { name: "站点导航" });
    expect(navigation.textContent).not.toContain("排行");
    for (const label of ["首页", "游戏", "搜索", "统计", "公告"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
  });
});
