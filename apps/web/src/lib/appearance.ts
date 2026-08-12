export const APPEARANCE_STORAGE_KEY = "touhoufriberg:appearance";

export const THEME_MODE_ATTRIBUTE = "themeMode";
export const THEME_COLOR_ATTRIBUTE = "themeColor";

export const THEME_MODES = ["light", "dark"] as const;

export type ThemeMode = (typeof THEME_MODES)[number];

export const COLOR_THEMES = [
  { id: "scarlet", label: "博丽灵梦", light: "#ad3334", dark: "#e0706c" },
  { id: "sakura", label: "古明地觉", light: "#c05a86", dark: "#dd82aa" },
  { id: "iris", label: "八云紫", light: "#6f63b6", dark: "#9b91e0" },
  { id: "jade", label: "东风谷早苗", light: "#247568", dark: "#59b9a7" },
  { id: "amber", label: "雾雨魔理沙", light: "#a76916", dark: "#d69a43" },
  { id: "azure", label: "比那名居天子", light: "#3478b4", dark: "#6ca6d9" },
] as const;

export type ThemeColor = (typeof COLOR_THEMES)[number]["id"];

export type AppearanceSettings = {
  mode: ThemeMode | null;
  color: ThemeColor;
};

export type ResolvedAppearance = {
  mode: ThemeMode;
  color: ThemeColor;
};

export const DEFAULT_THEME_COLOR: ThemeColor = "scarlet";

const THEME_COLOR_IDS = new Set<string>(COLOR_THEMES.map((theme) => theme.id));

let transitionTimer: number | undefined;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}

export function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && THEME_COLOR_IDS.has(value);
}

export function getSystemThemeMode(): ThemeMode {
  if (typeof window === "undefined" || !window.matchMedia) {
    return "light";
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function readAppearanceSettings(): AppearanceSettings {
  if (typeof window === "undefined") {
    return { mode: null, color: DEFAULT_THEME_COLOR };
  }

  try {
    const raw = window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) {
      return { mode: null, color: DEFAULT_THEME_COLOR };
    }

    const parsed = JSON.parse(raw) as {
      mode?: unknown;
      color?: unknown;
    };

    return {
      mode: isThemeMode(parsed.mode) ? parsed.mode : null,
      color: isThemeColor(parsed.color) ? parsed.color : DEFAULT_THEME_COLOR,
    };
  } catch {
    return { mode: null, color: DEFAULT_THEME_COLOR };
  }
}

export function writeAppearanceSettings(settings: AppearanceSettings) {
  if (typeof window === "undefined") {
    return;
  }

  const stored = {
    color: settings.color,
    ...(settings.mode ? { mode: settings.mode } : {}),
  };
  window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(stored));
}

export function resolveAppearance(
  settings: AppearanceSettings,
): ResolvedAppearance {
  return {
    mode: settings.mode ?? getSystemThemeMode(),
    color: settings.color,
  };
}

export function toggleThemeMode(mode: ThemeMode): ThemeMode {
  return mode === "dark" ? "light" : "dark";
}

export function applyAppearance(
  appearance: ResolvedAppearance,
  options: { animateMode?: boolean } = {},
) {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;

  if (options.animateMode) {
    root.classList.remove("theme-transitioning");
    void root.offsetWidth;
    root.classList.add("theme-transitioning");
    if (transitionTimer !== undefined) {
      window.clearTimeout(transitionTimer);
    }
    transitionTimer = window.setTimeout(() => {
      root.classList.remove("theme-transitioning");
    }, 260);
  }

  root.dataset[THEME_MODE_ATTRIBUTE] = appearance.mode;
  root.dataset[THEME_COLOR_ATTRIBUTE] = appearance.color;
  root.style.colorScheme = appearance.mode;
  updateThemeColorMeta(appearance.mode);
}

export function updateThemeColorMeta(mode: ThemeMode) {
  if (typeof document === "undefined") {
    return;
  }

  const meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (!meta) {
    return;
  }

  meta.content = mode === "dark" ? "#0f1413" : "#f2f5f3";
}
