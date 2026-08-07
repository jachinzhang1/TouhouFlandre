"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Moon } from "lucide-react";
import {
  applyAppearance,
  COLOR_THEMES,
  DEFAULT_THEME_COLOR,
  getSystemThemeMode,
  readAppearanceSettings,
  resolveAppearance,
  toggleThemeMode,
  writeAppearanceSettings,
  type AppearanceSettings,
  type ResolvedAppearance,
  type ThemeColor,
} from "../lib/appearance";

const defaultSettings: AppearanceSettings = {
  mode: null,
  color: DEFAULT_THEME_COLOR,
};

const defaultAppearance: ResolvedAppearance = {
  mode: "light",
  color: DEFAULT_THEME_COLOR,
};

export function AppearanceSwitcher() {
  const [settings, setSettings] =
    useState<AppearanceSettings>(defaultSettings);
  const [appearance, setAppearance] =
    useState<ResolvedAppearance>(defaultAppearance);

  useEffect(() => {
    const nextSettings = readAppearanceSettings();
    const nextAppearance = resolveAppearance(nextSettings);
    setSettings(nextSettings);
    setAppearance(nextAppearance);
    applyAppearance(nextAppearance);
  }, []);

  useEffect(() => {
    if (settings.mode || typeof window === "undefined" || !window.matchMedia) {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemModeChange = () => {
      const nextAppearance = {
        mode: getSystemThemeMode(),
        color: settings.color,
      };
      setAppearance(nextAppearance);
      applyAppearance(nextAppearance, { animateMode: true });
    };

    media.addEventListener("change", handleSystemModeChange);
    return () => media.removeEventListener("change", handleSystemModeChange);
  }, [settings]);

  const activeTheme = useMemo(
    () =>
      COLOR_THEMES.find((theme) => theme.id === appearance.color) ??
      COLOR_THEMES[0],
    [appearance.color],
  );

  const handleModeToggle = () => {
    const nextSettings = {
      ...settings,
      mode: toggleThemeMode(appearance.mode),
    };
    const nextAppearance = resolveAppearance(nextSettings);
    setSettings(nextSettings);
    setAppearance(nextAppearance);
    writeAppearanceSettings(nextSettings);
    applyAppearance(nextAppearance, { animateMode: true });
  };

  const handleColorSelect = (color: ThemeColor) => {
    const nextSettings = { ...settings, color };
    const nextAppearance = { ...appearance, color };
    setSettings(nextSettings);
    setAppearance(nextAppearance);
    writeAppearanceSettings(nextSettings);
    applyAppearance(nextAppearance);
  };

  return (
    <div className="appearance-switcher">
      <div className="appearance-palette" role="group" aria-label="主题色">
        {COLOR_THEMES.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={
              theme.id === activeTheme.id
                ? "appearance-swatch active"
                : "appearance-swatch"
            }
            style={
              {
                "--swatch-light": theme.light,
                "--swatch-dark": theme.dark,
              } as CSSProperties
            }
            aria-label={`${theme.label}主题`}
            aria-pressed={theme.id === activeTheme.id}
            title={`${theme.label}主题`}
            onClick={() => handleColorSelect(theme.id)}
          >
            <span className="sr-only">{theme.label}主题</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="appearance-toggle"
        aria-label={
          appearance.mode === "dark" ? "切换到浅色模式" : "切换到深色模式"
        }
        aria-pressed={appearance.mode === "dark"}
        title={appearance.mode === "dark" ? "切换到浅色模式" : "切换到深色模式"}
        onClick={handleModeToggle}
      >
        <Moon size={22} aria-hidden="true" />
      </button>
    </div>
  );
}
