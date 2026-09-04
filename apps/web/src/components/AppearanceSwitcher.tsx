"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { Paper } from "./Paper";
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

const themeControlLabel = (label: string) =>
  `${label}主题色${label === "雾雨魔理沙" ? "DA☆ZE" : ""}`;

const FAN_WIDTH = 760;
const FAN_HEIGHT = 220;
const FAN_APEX_X = FAN_WIDTH;
const FAN_APEX_Y_PX = 130;
const FAN_BASE_Y = FAN_HEIGHT;
const FAN_NEAR_ANGLE = 45;
const FAN_STRIPE_ANGLES = [3.5, 4.3, 5.2, 6.3, 7.7] as const;
const FAN_ANGLE_SPAN = FAN_STRIPE_ANGLES.reduce(
  (total, angle) => total + angle,
  0,
);
const FAN_FAR_ANGLE = FAN_NEAR_ANGLE + FAN_ANGLE_SPAN;
const FAN_APEX_Y = (FAN_APEX_Y_PX / FAN_HEIGHT) * 100;

function getBasePercent(angle: number) {
  const rise = FAN_BASE_Y - FAN_APEX_Y_PX;
  const run = rise * Math.tan((angle * Math.PI) / 180);
  return ((FAN_APEX_X - run) / FAN_WIDTH) * 100;
}

const FAN_BOUNDARY_ANGLES = [FAN_FAR_ANGLE];
for (const stripeAngle of FAN_STRIPE_ANGLES) {
  FAN_BOUNDARY_ANGLES.push(
    FAN_BOUNDARY_ANGLES[FAN_BOUNDARY_ANGLES.length - 1] - stripeAngle,
  );
}
const FAN_BOUNDARIES = FAN_BOUNDARY_ANGLES.map(getBasePercent);
const FAN_BASE_START = FAN_BOUNDARIES[0];
const FAN_BASE_END = FAN_BOUNDARIES[FAN_BOUNDARIES.length - 1];

function getFanBoundary(index: number) {
  return FAN_BOUNDARIES[index];
}

function getFanTriangle(index: number) {
  const start = getFanBoundary(index);
  const end = getFanBoundary(index + 1);
  return `polygon(100% ${FAN_APEX_Y}%, ${start}% 100%, ${end}% 100%)`;
}

function getCollapsedFanTriangle(index: number) {
  const point = getFanBoundary(index);
  return `polygon(100% ${FAN_APEX_Y}%, ${point}% 100%, ${point}% 100%)`;
}

export function AppearanceSwitcher({
  mobilePaletteOpen = false,
  onMobilePaletteOpenChange,
}: {
  mobilePaletteOpen?: boolean;
  onMobilePaletteOpenChange?: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<AppearanceSettings>(defaultSettings);
  const [appearance, setAppearance] =
    useState<ResolvedAppearance>(defaultAppearance);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [hoverOpen, setHoverOpen] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const internalPaletteVisible = paletteOpen || hoverOpen;
  const paletteVisible = mobilePaletteOpen || internalPaletteVisible;

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
    if (!internalPaletteVisible) return;
    const closePalette = (restoreToggleFocus = false) => {
      setPaletteOpen(false);
      setHoverOpen(false);
      if (restoreToggleFocus) {
        toggleRef.current?.focus();
        return;
      }
      if (
        document.activeElement instanceof HTMLElement &&
        switcherRef.current?.contains(document.activeElement) &&
        document.activeElement !== toggleRef.current
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
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePalette(true);
    };

    document.addEventListener("pointerdown", handleOutsidePointer);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [internalPaletteVisible]);

  const activeTheme = useMemo(
    () =>
      COLOR_THEMES.find((theme) => theme.id === appearance.color) ??
      COLOR_THEMES[0],
    [appearance.color],
  );
  const activeThemeIndex = useMemo(
    () => COLOR_THEMES.findIndex((theme) => theme.id === activeTheme.id),
    [activeTheme.id],
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
  const handleToggleClick = () => {
    const usesMobilePresentation =
      Boolean(onMobilePaletteOpenChange) &&
      window.matchMedia("(max-width: 680px)").matches;
    if (usesMobilePresentation) {
      if (mobilePaletteOpen) handleModeToggle();
      else onMobilePaletteOpenChange?.(true);
      return;
    }
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
      data-open={mobilePaletteOpen || paletteOpen ? "true" : "false"}
      data-hovered={hoverOpen ? "true" : "false"}
      style={
        {
          "--appearance-apex-y": `${FAN_APEX_Y}%`,
          "--appearance-base-start": `${FAN_BASE_START}%`,
          "--appearance-diagonal-end": `${FAN_BASE_END}%`,
        } as CSSProperties
      }
      onPointerEnter={() => {
        if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
          setHoverOpen(true);
        }
      }}
      onPointerLeave={() => setHoverOpen(false)}
    >
      <Paper
        animateOnMount={false}
        ariaHidden
        className="appearance-corner-surface"
        shape="corner"
        elevation="sm"
        folded={false}
        sticker={false}
        unfoldOnHover={false}
        variant="tinted"
      />
      <Paper
        animateOnMount={false}
        ariaControls="appearance-palette"
        ariaExpanded={paletteVisible}
        ariaLabel={
          paletteVisible
            ? appearance.mode === "dark"
              ? "切换到浅色模式"
              : "切换到深色模式"
            : "打开主题颜色"
        }
        ariaPressed={paletteVisible ? appearance.mode === "dark" : undefined}
        as="button"
        buttonRef={toggleRef}
        className="appearance-toggle"
        folded={false}
        onClick={handleToggleClick}
        shape="control"
        sticker={false}
        title={
          paletteVisible
            ? appearance.mode === "dark"
              ? "切换到浅色模式"
              : "切换到深色模式"
            : "打开主题颜色"
        }
        unfoldOnHover={false}
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
      </Paper>
      <div
        id="appearance-palette"
        className="appearance-palette"
        role="group"
        aria-label="角色主题色"
        aria-hidden={paletteVisible ? undefined : true}
      >
        <Paper
          animateOnMount={false}
          ariaHidden
          className="appearance-mobile-palette-paper"
          elevation="lg"
          folded={false}
          sticker={false}
          unfoldOnHover={false}
        />
        {COLOR_THEMES.map((theme, index) => {
          const selected = theme.id === activeTheme.id;
          const slot = index < activeThemeIndex ? index : index - 1;
          const triangleClip = selected
            ? getCollapsedFanTriangle(index)
            : getFanTriangle(slot);
          return (
            <button
              key={theme.id}
              type="button"
              className="appearance-swatch"
              data-selected={selected ? "true" : "false"}
              data-slot={selected ? undefined : slot}
              data-theme-color={theme.id}
              style={
                {
                  "--swatch-color-light": theme.light,
                  "--swatch-color-dark": theme.dark,
                  "--swatch-clip": triangleClip,
                } as CSSProperties
              }
              aria-hidden={
                !paletteVisible || (selected && !mobilePaletteOpen) || undefined
              }
              aria-label={themeControlLabel(theme.label)}
              aria-pressed={selected}
              disabled={selected}
              tabIndex={paletteVisible && !selected ? 0 : -1}
              title={themeControlLabel(theme.label)}
              onClick={() => handleColorSelect(theme.id)}
            >
              <span className="sr-only">{themeControlLabel(theme.label)}</span>
              {selected ? (
                <Check
                  className="appearance-swatch-check"
                  size={18}
                  strokeWidth={2.4}
                  aria-hidden="true"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
