import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSwitcher } from "./AppearanceSwitcher";
import { APPEARANCE_STORAGE_KEY, COLOR_THEMES } from "../../lib/appearance";

function mockSystemMode(isDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation((query: string) => ({
      matches:
        query === "(prefers-color-scheme: dark)"
          ? isDark
          : query === "(hover: hover) and (pointer: fine)",
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    configurable: true,
    writable: true,
  });
}

describe("AppearanceSwitcher", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.themeMode = "";
    document.documentElement.dataset.themeColor = "";
    document.documentElement.className = "";
    document.head.innerHTML = '<meta name="theme-color" content="#f2f5f3">';
    mockSystemMode(false);
  });

  it("uses the system color scheme when no explicit mode is saved", async () => {
    mockSystemMode(true);

    render(<AppearanceSwitcher />);

    await waitFor(() => {
      expect(document.documentElement.dataset.themeMode).toBe("dark");
    });
    expect(document.documentElement.dataset.themeColor).toBe("scarlet");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe("#0f1413");
  });

  it("opens the palette before toggling mode and stores the explicit preference", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    expect(document.querySelector(".appearance-fold-flap")).toBeNull();
    const cornerSurface = document.querySelector(".appearance-corner-surface");
    expect(cornerSurface?.getAttribute("data-paper-variant")).toBe("tinted");
    expect(cornerSurface?.getAttribute("data-paper-elevation")).toBe("sm");
    expect(cornerSurface?.getAttribute("data-paper-folded")).toBe("false");
    expect(cornerSurface?.getAttribute("data-paper-shape")).toBe("corner");
    expect(
      screen.getByRole("button", { name: "打开主题颜色" }).dataset.paperShape,
    ).toBe("control");
    const mobilePalettePaper = document.querySelector(
      ".appearance-mobile-palette-paper",
    );
    expect(mobilePalettePaper?.getAttribute("data-paper-elevation")).toBe("lg");
    expect(mobilePalettePaper?.getAttribute("data-paper-folded")).toBe("false");

    await waitFor(() => {
      expect(document.documentElement.dataset.themeMode).toBe("light");
    });

    const paletteButton = screen.getByRole("button", {
      name: "打开主题颜色",
    });
    await user.hover(paletteButton);

    expect(document.documentElement.dataset.themeMode).toBe("light");
    expect(paletteButton.getAttribute("aria-expanded")).toBe("true");

    await user.click(screen.getByRole("button", { name: "切换到深色模式" }));

    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(
      document.documentElement.classList.contains("theme-transitioning"),
    ).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      color: "scarlet",
      mode: "dark",
    });
  });

  it("opens on desktop hover and collapses on dehover", async () => {
    const user = userEvent.setup();
    const { container } = render(<AppearanceSwitcher />);
    const switcher = container.querySelector(".appearance-switcher")!;
    const toggle = screen.getByRole("button", { name: "打开主题颜色" });

    await user.hover(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "切换到深色模式" })).toBe(toggle);
    expect(switcher.getAttribute("data-hovered")).toBe("true");

    await user.unhover(switcher);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("打开主题颜色");
    expect(switcher.getAttribute("data-hovered")).toBe("false");
  });

  it("keeps closed swatches out of navigation and returns focus on Escape", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    const toggle = screen.getByRole("button", { name: "打开主题颜色" });

    expect(
      document
        .querySelector(".appearance-palette")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(".appearance-swatch"),
      ).every((swatch) => swatch.tabIndex === -1),
    ).toBe(true);

    toggle.focus();
    await user.keyboard("{Enter}");
    const firstSwatch = screen.getByRole("button", { name: "古明地觉主题色" });
    expect(firstSwatch.tabIndex).toBe(0);
    firstSwatch.focus();
    await user.keyboard("{Escape}");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("selects a color theme without freezing the system mode default", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    const sakura = COLOR_THEMES.find((theme) => theme.id === "sakura");

    await user.hover(screen.getByRole("button", { name: "打开主题颜色" }));
    await user.click(screen.getByRole("button", { name: "古明地觉主题色" }));

    expect(document.documentElement.dataset.themeColor).toBe("sakura");
    expect(screen.queryByRole("button", { name: "古明地觉主题色" })).toBeNull();
    expect(screen.getByRole("button", { name: "博丽灵梦主题色" })).toBeTruthy();
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ color: sakura?.id }),
    );
  });

  it("moves only the stripes between the old and new selections", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    await user.hover(screen.getByRole("button", { name: "打开主题颜色" }));
    const slot = (name: string) =>
      screen.getByRole("button", { name }).dataset.slot;

    expect(slot("古明地觉主题色")).toBe("0");
    expect(slot("比那名居天子主题色")).toBe("4");

    await user.click(
      screen.getByRole("button", { name: "雾雨魔理沙主题色DA☆ZE" }),
    );

    expect(slot("博丽灵梦主题色")).toBe("0");
    expect(slot("古明地觉主题色")).toBe("1");
    expect(slot("八云紫主题色")).toBe("2");
    expect(slot("东风谷早苗主题色")).toBe("3");
    expect(slot("比那名居天子主题色")).toBe("4");

    await user.click(screen.getByRole("button", { name: "古明地觉主题色" }));

    expect(slot("博丽灵梦主题色")).toBe("0");
    expect(slot("八云紫主题色")).toBe("1");
    expect(slot("东风谷早苗主题色")).toBe("2");
    expect(slot("雾雨魔理沙主题色DA☆ZE")).toBe("3");
    expect(slot("比那名居天子主题色")).toBe("4");
  });

  it("offers the five inactive character theme colors", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    await user.hover(screen.getByRole("button", { name: "打开主题颜色" }));

    expect(screen.queryByRole("button", { name: "博丽灵梦主题色" })).toBeNull();
    for (const name of [
      "古明地觉主题色",
      "八云紫主题色",
      "东风谷早苗主题色",
      "雾雨魔理沙主题色DA☆ZE",
      "比那名居天子主题色",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
    const sakuraButton = screen.getByRole("button", {
      name: "古明地觉主题色",
    });
    expect(sakuraButton.style.getPropertyValue("--swatch-color")).toBe(
      "#b9507f",
    );
    expect(sakuraButton.style.getPropertyValue("--swatch-dark")).toBe("");

    await user.click(
      screen.getByRole("button", { name: "比那名居天子主题色" }),
    );

    expect(document.documentElement.dataset.themeColor).toBe("azure");
    expect(
      screen.queryByRole("button", { name: "比那名居天子主题色" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "博丽灵梦主题色" })).toBeTruthy();
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ color: "azure" }),
    );
  });
});
