"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Moon, Palette, Sun } from "lucide-react";
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
} from "../../lib/appearance";

const defaultSettings: AppearanceSettings = {
  mode: null,
  color: DEFAULT_THEME_COLOR,
};

const defaultAppearance: ResolvedAppearance = {
  mode: "light",
  color: DEFAULT_THEME_COLOR,
};

const themeControlLabel = (label: string) =>
  `${label}主题色${label === "雾雨魔理沙" ? "DA☆ZE" : ""}`;

const FAN_APEX_Y = (130 / 220) * 100;
const FAN_BASE_START = (382 / 760) * 100;
const FAN_BASE_END = (670 / 760) * 100;
const FAN_STEP = (FAN_BASE_END - FAN_BASE_START) / COLOR_THEMES.length;

function getFanTriangle(index: number) {
  const start = FAN_BASE_START + FAN_STEP * index;
  const end = start + FAN_STEP;
  return `polygon(100% ${FAN_APEX_Y}%, ${start}% 100%, ${end}% 100%)`;
}

export function AppearanceSwitcher() {
  const [settings, setSettings] = useState<AppearanceSettings>(defaultSettings);
  const [appearance, setAppearance] =
    useState<ResolvedAppearance>(defaultAppearance);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    const closePalette = () => {
      setPaletteOpen(false);
      if (
        document.activeElement instanceof HTMLElement &&
        switcherRef.current?.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
    };
    const handleOutsidePointer = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !switcherRef.current?.contains(event.target)
      ) {
        closePalette();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePalette();
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

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
  const paletteVisible = paletteOpen || hoverOpen;
  const handleToggleClick = () => {
    if (!paletteVisible) {
      setPaletteOpen(true);
      return;
    }
    handleModeToggle();
  };

  return (
    <div
      ref={switcherRef}
      className="appearance-switcher"
      data-open={paletteOpen ? "true" : "false"}
      data-hovered={hoverOpen ? "true" : "false"}
      onPointerEnter={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          setHoverOpen(true);
        }
      }}
      onPointerLeave={() => setHoverOpen(false)}
    >
      <div
        id="appearance-palette"
        className="appearance-palette"
        role="group"
        aria-label="角色主题色"
      >
        {COLOR_THEMES.map((theme, index) => {
          const triangleClip = getFanTriangle(index);
          return (
            <button
              key={theme.id}
              type="button"
              className={
                theme.id === activeTheme.id
                  ? "appearance-swatch active"
                  : "appearance-swatch"
              }
              data-theme-color={theme.id}
              style={
                {
                  "--swatch-light": theme.light,
                  "--swatch-dark": theme.dark,
                  "--swatch-clip": triangleClip,
                } as CSSProperties
              }
              aria-label={themeControlLabel(theme.label)}
              aria-pressed={theme.id === activeTheme.id}
              title={themeControlLabel(theme.label)}
              onClick={() => handleColorSelect(theme.id)}
            >
              <span className="sr-only">{themeControlLabel(theme.label)}</span>
            </button>
          );
        })}
      </div>
      <span className="appearance-corner-surface" aria-hidden="true" />
      <span className="appearance-fold-flap" aria-hidden="true" />
      <button
        type="button"
        className="appearance-toggle"
        aria-label={
          paletteVisible
            ? appearance.mode === "dark"
              ? "切换到浅色模式"
              : "切换到深色模式"
            : "打开主题颜色"
        }
        aria-controls="appearance-palette"
        aria-expanded={paletteVisible}
        aria-pressed={paletteVisible ? appearance.mode === "dark" : undefined}
        title={
          paletteVisible
            ? appearance.mode === "dark"
              ? "切换到浅色模式"
              : "切换到深色模式"
            : "打开主题颜色"
        }
        onClick={handleToggleClick}
      >
        <Palette
          className="appearance-palette-icon"
          size={22}
          aria-hidden="true"
        />
        {appearance.mode === "dark" ? (
          <Sun className="appearance-mode-icon" size={22} aria-hidden="true" />
        ) : (
          <Moon className="appearance-mode-icon" size={22} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
