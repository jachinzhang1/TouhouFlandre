import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  appearanceBootstrapConfig,
  bootstrapAppearance,
  createAppearanceBootstrapScript,
} from "./appearanceBootstrap";

function mockSystemMode(isDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: isDark }),
  });
}

describe("appearance bootstrap", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.dataset.themeMode = "";
    document.documentElement.dataset.themeColor = "";
    document.documentElement.style.colorScheme = "";
    document.head.innerHTML = '<meta name="theme-color" content="#f2f5f3">';
    mockSystemMode(false);
  });

  it("applies a valid stored preference", () => {
    localStorage.setItem(
      appearanceBootstrapConfig.storageKey,
      JSON.stringify({ color: "iris", mode: "dark" }),
    );

    bootstrapAppearance(appearanceBootstrapConfig);

    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.themeColor).toBe("iris");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(
      document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
        ?.content,
    ).toBe("#0f1413");
  });

  it("falls back safely for malformed storage", () => {
    mockSystemMode(true);
    localStorage.setItem(appearanceBootstrapConfig.storageKey, "not-json");

    bootstrapAppearance(appearanceBootstrapConfig);

    expect(document.documentElement.dataset.themeMode).toBe("dark");
    expect(document.documentElement.dataset.themeColor).toBe("scarlet");
    expect(createAppearanceBootstrapScript()).toContain("bootstrapAppearance");
  });
});
