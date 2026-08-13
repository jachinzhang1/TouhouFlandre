import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANNOUNCEMENTS_READ_STORAGE_KEY } from "../../announcements/readState";
import { SiteNav } from "./SiteNav";

const navigationState = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

describe("SiteNav", () => {
  beforeEach(() => {
    localStorage.clear();
    navigationState.pathname = "/";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("隐藏排行榜入口并保留其他导航项", async () => {
    mockAnnouncementSummary([]);
    const { container } = render(<SiteNav />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    const navigation = screen.getByRole("navigation", { name: "站点导航" });
    expect(navigation.textContent).not.toContain("排行");
    for (const label of ["首页", "游戏", "搜索", "统计", "公告"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }
    const activeCopy = container.querySelector(".nav-active-copy");
    expect(activeCopy?.getAttribute("aria-hidden")).toBe("true");
    expect(activeCopy?.querySelector("a")).toBeNull();
    expect(container.querySelector(".site-nav .paper-sticker")).toBeNull();
  });

  it("没有匹配页签时不渲染白色遮罩副本", async () => {
    navigationState.pathname = "/definitely-missing";
    mockAnnouncementSummary([]);
    const { container } = render(<SiteNav />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    expect(container.querySelector(".nav-active-copy")).toBeNull();
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("公告存在未读时显示导航提示点及遮罩副本", async () => {
    mockAnnouncementSummary([
      { id: "notice-a", title: "公告", date: "2026-08-08" },
    ]);
    const { container } = render(<SiteNav />);

    expect(
      await screen.findByRole("link", { name: "公告，有未读公告" }),
    ).toBeTruthy();
    expect(container.querySelectorAll(".nav-unread-dot")).toHaveLength(2);
    expect(
      container.querySelector(".nav-active-copy .nav-unread-dot"),
    ).toBeTruthy();
  });

  it("公告已读时不显示导航红点", async () => {
    localStorage.setItem(
      ANNOUNCEMENTS_READ_STORAGE_KEY,
      JSON.stringify(["notice-a"]),
    );
    mockAnnouncementSummary([
      { id: "notice-a", title: "公告", date: "2026-08-08" },
    ]);
    const { container } = render(<SiteNav />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    expect(screen.getByRole("link", { name: "公告" })).toBeTruthy();
    expect(container.querySelector(".nav-unread-dot")).toBeNull();
  });
});

function mockAnnouncementSummary(
  announcements: { id: string; title: string; date: string }[],
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          announcements: announcements.map((item) => ({
            ...item,
            pinned: false,
            fileName: `${item.id}.md`,
          })),
          generatedAt: "2026-08-08T00:00:00.000Z",
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    ),
  );
}
