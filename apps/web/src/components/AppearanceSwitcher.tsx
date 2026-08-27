"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Moon } from "lucide-react";
import { useAnchoredFloatingPanel } from "../hooks/useAnchoredFloatingPanel";
import { useDraggableFloatingControl } from "../hooks/useDraggableFloatingControl";
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

function getDefaultAppearancePosition(
  bounds: { right: number; bottom: number },
  controlSize: { width: number; height: number },
) {
  const compact = window.innerWidth <= 680;
  const edgeOffset = compact ? 2 : 10;
  return {
    x: bounds.right - controlSize.width - edgeOffset,
    y: bounds.bottom - controlSize.height - edgeOffset,
  };
}

export function AppearanceSwitcher() {
  const [settings, setSettings] = useState<AppearanceSettings>(defaultSettings);
  const [appearance, setAppearance] =
    useState<ResolvedAppearance>(defaultAppearance);
  const boundaryRef = useRef<HTMLDivElement>(null);
  const switcherRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const { positionStyle, isDragging, dragHandleProps } =
    useDraggableFloatingControl({
      controlId: "appearance",
      boundaryRef,
      floatingRef: switcherRef,
      handleRef: toggleRef,
      getDefaultPosition: getDefaultAppearancePosition,
    });
  const panelPosition = useAnchoredFloatingPanel({
    boundaryRef,
    anchorRef: toggleRef,
    panelRef: paletteRef,
    positionKey: `${String(positionStyle.left)}:${String(positionStyle.top)}`,
  });

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
    <div
      ref={boundaryRef}
      className="floating-control-boundary appearance-control-boundary"
      data-floating-control-boundary="appearance"
    >
      <div
        ref={switcherRef}
        className="appearance-switcher"
        data-dragging={isDragging}
        style={positionStyle}
      >
        <div
          ref={paletteRef}
          className="appearance-palette"
          role="group"
          aria-label="主题色"
          data-vertical={panelPosition.vertical}
          data-horizontal={panelPosition.horizontal}
          style={panelPosition.panelStyle}
        >
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
          {...dragHandleProps}
          ref={toggleRef}
          type="button"
          className="appearance-toggle"
          aria-label={
            appearance.mode === "dark" ? "切换到浅色模式" : "切换到深色模式"
          }
          aria-pressed={appearance.mode === "dark"}
          title={
            appearance.mode === "dark" ? "切换到浅色模式" : "切换到深色模式"
          }
          onClick={handleModeToggle}
        >
          <Moon size={22} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
