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

  it("toggles mode and stores an explicit preference", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);

    await waitFor(() => {
      expect(document.documentElement.dataset.themeMode).toBe("light");
    });

    await user.click(screen.getByRole("button", { name: "切换到深色模式" }));

    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.classList.contains("theme-transitioning")).toBe(
      true,
    );
    expect(JSON.parse(localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "{}")).toEqual(
      {
        color: "scarlet",
        mode: "dark",
      },
    );
  });

  it("selects a color theme without freezing the system mode default", async () => {
    const user = userEvent.setup();
    render(<AppearanceSwitcher />);
    const sakura = COLOR_THEMES.find((theme) => theme.id === "sakura");

    await user.click(screen.getByRole("button", { name: "樱粉主题" }));

    expect(document.documentElement.dataset.themeColor).toBe("sakura");
    expect(screen.getByRole("button", { name: "樱粉主题" }).getAttribute(
      "aria-pressed",
    )).toBe("true");
    expect(localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe(
      JSON.stringify({ color: sakura?.id }),
    );
  });
});
