import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppearanceSwitcher } from "./AppearanceSwitcher";
import { APPEARANCE_STORAGE_KEY, COLOR_THEMES } from "../lib/appearance";

function mockSystemMode(isDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: vi.fn().mockImplementation((query: string) => ({
      matches: isDark,
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

    await waitFor(() => {
      expect(document.documentElement.dataset.themeMode).toBe("light");
    });

    const paletteButton = screen.getByRole("button", {
      name: "打开主题颜色",
    });
    await user.click(paletteButton);

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

  it("selects a color theme without freezing the system mode default", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    const sakura = COLOR_THEMES.find((theme) => theme.id === "sakura");

    await user.click(screen.getByRole("button", { name: "古明地觉主题色" }));

    expect(document.documentElement.dataset.themeColor).toBe("sakura");
    expect(
      screen
        .getByRole("button", { name: "古明地觉主题色" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ color: sakura?.id }),
    );
  });

  it("offers all six character theme colors", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);

    for (const name of [
      "博丽灵梦主题色",
      "古明地觉主题色",
      "八云紫主题色",
      "东风谷早苗主题色",
      "雾雨魔理沙主题色DA☆ZE",
      "比那名居天子主题色",
    ]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }

    await user.click(
      screen.getByRole("button", { name: "比那名居天子主题色" }),
    );

    expect(document.documentElement.dataset.themeColor).toBe("azure");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ color: "azure" }),
    );
  });
});
