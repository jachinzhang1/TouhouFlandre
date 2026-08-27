import { beforeEach, describe, expect, it } from "vitest";
import {
  FLOATING_CONTROLS_STORAGE_KEY,
  clampPosition,
  denormalizePosition,
  insetViewportBounds,
  loadFloatingControlPositions,
  normalizePosition,
  resolvePanelPlacement,
  saveFloatingControlPosition,
} from "./floatingControls";

const bounds = { left: 12, top: 12, right: 388, bottom: 288 };
const controlSize = { width: 48, height: 48 };

describe("floating control geometry", () => {
  it("creates an inset viewport and clamps every control edge", () => {
    expect(
      insetViewportBounds(
        { width: 400, height: 300 },
        { top: 12, right: 12, bottom: 80, left: 12 },
      ),
    ).toEqual({ left: 12, top: 12, right: 388, bottom: 220 });
    expect(clampPosition({ x: -100, y: -100 }, controlSize, bounds)).toEqual({
      x: 12,
      y: 12,
    });
    expect(clampPosition({ x: 500, y: 500 }, controlSize, bounds)).toEqual({
      x: 340,
      y: 240,
    });
  });

  it("round-trips normalized positions across viewport sizes", () => {
    const normalized = normalizePosition(
      { x: 176, y: 126 },
      controlSize,
      bounds,
    );
    expect(normalized).toEqual({ xRatio: 0.5, yRatio: 0.5 });
    expect(
      denormalizePosition(normalized, controlSize, {
        left: 0,
        top: 0,
        right: 248,
        bottom: 148,
      }),
    ).toEqual({ x: 100, y: 50 });
  });

  it("places panels toward the viewport interior and flips above when needed", () => {
    expect(
      resolvePanelPlacement(
        { left: 20, top: 20, right: 68, bottom: 68 },
        { width: 200, height: 120 },
        bounds,
      ),
    ).toMatchObject({
      left: 20,
      top: 78,
      vertical: "below",
      horizontal: "left",
    });

    const upperPlacement = resolvePanelPlacement(
      { left: 330, top: 230, right: 378, bottom: 278 },
      { width: 200, height: 160 },
      bounds,
    );
    expect(upperPlacement).toMatchObject({
      left: 178,
      top: 60,
      vertical: "above",
      horizontal: "right",
      maxHeight: 208,
    });
  });

  it("limits an oversized panel to the side with more available space", () => {
    expect(
      resolvePanelPlacement(
        { left: 176, top: 126, right: 224, bottom: 174 },
        { width: 500, height: 500 },
        bounds,
      ),
    ).toMatchObject({
      left: 12,
      maxWidth: 376,
      maxHeight: 104,
      vertical: "below",
    });
  });
});

describe("floating control position storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("merges independently saved control positions", () => {
    expect(
      saveFloatingControlPosition("appearance", { xRatio: 0.1, yRatio: 0.9 }),
    ).toBe(true);
    expect(
      saveFloatingControlPosition("musicPlayer", { xRatio: 0.8, yRatio: 0.2 }),
    ).toBe(true);
    expect(loadFloatingControlPositions()).toEqual({
      positions: {
        appearance: { xRatio: 0.1, yRatio: 0.9 },
        musicPlayer: { xRatio: 0.8, yRatio: 0.2 },
      },
      canWrite: true,
    });
  });

  it("repairs damaged and out-of-range entries on the next save", () => {
    localStorage.setItem(
      FLOATING_CONTROLS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: 1,
        positions: {
          appearance: { xRatio: -1, yRatio: 3 },
          musicPlayer: { xRatio: 0.25, yRatio: 0.75 },
        },
      }),
    );
    expect(loadFloatingControlPositions()).toEqual({
      positions: { musicPlayer: { xRatio: 0.25, yRatio: 0.75 } },
      canWrite: true,
    });
    expect(
      saveFloatingControlPosition("appearance", { xRatio: 0, yRatio: 1 }),
    ).toBe(true);
    expect(
      JSON.parse(localStorage.getItem(FLOATING_CONTROLS_STORAGE_KEY)!),
    ).toEqual({
      schemaVersion: 1,
      positions: {
        appearance: { xRatio: 0, yRatio: 1 },
        musicPlayer: { xRatio: 0.25, yRatio: 0.75 },
      },
    });
  });

  it("does not overwrite a future storage version", () => {
    const future = JSON.stringify({ schemaVersion: 2, positions: {} });
    localStorage.setItem(FLOATING_CONTROLS_STORAGE_KEY, future);
    expect(loadFloatingControlPositions()).toEqual({
      positions: {},
      canWrite: false,
    });
    expect(
      saveFloatingControlPosition("appearance", { xRatio: 0.5, yRatio: 0.5 }),
    ).toBe(false);
    expect(localStorage.getItem(FLOATING_CONTROLS_STORAGE_KEY)).toBe(future);
  });
});
