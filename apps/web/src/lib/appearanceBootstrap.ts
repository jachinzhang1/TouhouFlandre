import {
  APPEARANCE_STORAGE_KEY,
  COLOR_THEMES,
  DEFAULT_THEME_COLOR,
} from "./appearance";

export type AppearanceBootstrapConfig = {
  colors: string[];
  defaultColor: string;
  storageKey: string;
  themeColors: {
    dark: string;
    light: string;
  };
};

export const appearanceBootstrapConfig: AppearanceBootstrapConfig = {
  colors: COLOR_THEMES.map((theme) => theme.id),
  defaultColor: DEFAULT_THEME_COLOR,
  storageKey: APPEARANCE_STORAGE_KEY,
  themeColors: {
    dark: "#0f1413",
    light: "#f2f5f3",
  },
};

export function bootstrapAppearance(config: AppearanceBootstrapConfig) {
  const colorIds = new Set(config.colors);
  const systemMode = () =>
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  let stored: Record<string, unknown> = {};

  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(config.storageKey) ?? "{}",
    );
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      stored = parsed as Record<string, unknown>;
    }
  } catch {
    stored = {};
  }

  const mode =
    stored.mode === "light" || stored.mode === "dark"
      ? stored.mode
      : systemMode();
  const color =
    typeof stored.color === "string" && colorIds.has(stored.color)
      ? stored.color
      : config.defaultColor;
  const root = document.documentElement;
  root.dataset.themeMode = mode;
  root.dataset.themeColor = color;
  root.style.colorScheme = mode;

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  meta?.setAttribute("content", config.themeColors[mode]);
}

export function createAppearanceBootstrapScript() {
  return `(${bootstrapAppearance.toString()})(${JSON.stringify(
    appearanceBootstrapConfig,
  )});`;
}
