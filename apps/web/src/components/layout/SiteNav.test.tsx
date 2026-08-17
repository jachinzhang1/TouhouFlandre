import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(
      navigation.contains(screen.getByRole("button", { name: "打开主题颜色" })),
    ).toBe(true);
    const activeCopy = container.querySelector(".nav-active-copy");
    expect(activeCopy?.getAttribute("aria-hidden")).toBe("true");
    expect(activeCopy?.querySelector("a")).toBeNull();
    expect(container.querySelector(".site-nav .paper-sticker")).toBeNull();
    const contrastPapers = container.querySelectorAll(
      '[data-paper-tone="contrast"]',
    );
    expect(contrastPapers).toHaveLength(2);
    for (const paper of contrastPapers) {
      expect(paper.getAttribute("data-paper-elevation")).toBe("accent");
    }
  });

  it("切换移动端导航并在导航后转移焦点", async () => {
    mockMobileViewport();
    mockAnnouncementSummary([]);
    const { container } = render(
      <>
        <SiteNav />
        <main className="site-main" tabIndex={-1} />
      </>,
    );

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    const navigation = screen.getByRole("navigation", { name: "站点导航" });
    const toggle = screen.getByRole("button", { name: "展开站点导航" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(navigation.getAttribute("data-mobile-menu-open")).toBe("false");
    expect(navigation.getAttribute("data-mobile-presentation")).toBe("none");
    toggle.focus();
    fireEvent.click(toggle);
    expect(
      screen
        .getByRole("button", { name: "关闭站点导航" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(navigation.getAttribute("data-mobile-menu-open")).toBe("true");
    expect(navigation.getAttribute("data-mobile-presentation")).toBe(
      "navigation",
    );
    expect(container.querySelector(".site-nav-menu-icon")).toBeTruthy();
    expect(container.querySelector(".site-nav-close-icon")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(navigation.getAttribute("data-mobile-menu-open")).toBe("false");
    expect(document.activeElement).toBe(toggle);
    expect(navigation.getAttribute("data-mobile-presentation")).toBe("none");
    await fireEvent.click(screen.getByRole("button", { name: "打开主题颜色" }));
    expect(navigation.getAttribute("data-mobile-menu-open")).toBe("false");
    expect(navigation.getAttribute("data-mobile-presentation")).toBe("palette");
    expect(
      screen
        .getByRole("button", { name: "关闭主题颜色" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getAllByRole("button", { name: /主题色/ })).toHaveLength(6);
    expect(
      container.querySelector(
        '.appearance-swatch[data-selected="true"] .lucide-check',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "关闭主题颜色" }));
    expect(navigation.getAttribute("data-mobile-presentation")).toBe("none");
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole("link", { name: "游戏" }), {
      ctrlKey: true,
    });
    expect(navigation.getAttribute("data-mobile-menu-open")).toBe("false");
    expect(document.activeElement).toBe(container.querySelector(".site-main"));
  });

  it("没有匹配页签时不渲染白色遮罩副本", async () => {
    navigationState.pathname = "/definitely-missing";
    mockAnnouncementSummary([]);
    const { container } = render(<SiteNav />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    expect(container.querySelector(".nav-active-copy")).toBeNull();
    expect(container.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("题库设置页保持游戏页签选中", async () => {
    navigationState.pathname = "/settings";
    mockAnnouncementSummary([]);
    render(<SiteNav />);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledOnce());
    expect(
      screen.getByRole("link", { name: "游戏" }).getAttribute("aria-current"),
    ).toBe("page");
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

function mockMobileViewport() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 680px)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
