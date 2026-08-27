export const FLOATING_CONTROLS_STORAGE_KEY = "touhoufriberg:floating-controls";

export type FloatingControlId = "appearance" | "musicPlayer";

export type FloatingPoint = {
  x: number;
  y: number;
};

export type FloatingSize = {
  width: number;
  height: number;
};

export type FloatingBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type ViewportInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type NormalizedFloatingPosition = {
  xRatio: number;
  yRatio: number;
};

export type StoredFloatingControlPositionsV1 = {
  schemaVersion: 1;
  positions: Partial<Record<FloatingControlId, NormalizedFloatingPosition>>;
};

export type FloatingControlStorageLoadResult = {
  positions: Partial<Record<FloatingControlId, NormalizedFloatingPosition>>;
  canWrite: boolean;
};

export type FloatingPanelPlacement = {
  left: number;
  top: number;
  maxWidth: number;
  maxHeight: number;
  vertical: "above" | "below";
  horizontal: "left" | "right";
};

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

export function insetViewportBounds(
  viewport: FloatingSize,
  insets: ViewportInsets,
): FloatingBounds {
  const width = Math.max(0, finiteOrZero(viewport.width));
  const height = Math.max(0, finiteOrZero(viewport.height));
  const left = clamp(finiteOrZero(insets.left), 0, width);
  const top = clamp(finiteOrZero(insets.top), 0, height);
  const right = clamp(width - finiteOrZero(insets.right), left, width);
  const bottom = clamp(height - finiteOrZero(insets.bottom), top, height);
  return { left, top, right, bottom };
}

export function clampPosition(
  position: FloatingPoint,
  controlSize: FloatingSize,
  bounds: FloatingBounds,
): FloatingPoint {
  const width = Math.max(0, finiteOrZero(controlSize.width));
  const height = Math.max(0, finiteOrZero(controlSize.height));
  return {
    x: clamp(finiteOrZero(position.x), bounds.left, bounds.right - width),
    y: clamp(finiteOrZero(position.y), bounds.top, bounds.bottom - height),
  };
}

export function normalizePosition(
  position: FloatingPoint,
  controlSize: FloatingSize,
  bounds: FloatingBounds,
): NormalizedFloatingPosition {
  const clamped = clampPosition(position, controlSize, bounds);
  const xRange = Math.max(0, bounds.right - bounds.left - controlSize.width);
  const yRange = Math.max(0, bounds.bottom - bounds.top - controlSize.height);
  return {
    xRatio: xRange === 0 ? 0 : (clamped.x - bounds.left) / xRange,
    yRatio: yRange === 0 ? 0 : (clamped.y - bounds.top) / yRange,
  };
}

export function denormalizePosition(
  position: NormalizedFloatingPosition,
  controlSize: FloatingSize,
  bounds: FloatingBounds,
): FloatingPoint {
  const xRange = Math.max(0, bounds.right - bounds.left - controlSize.width);
  const yRange = Math.max(0, bounds.bottom - bounds.top - controlSize.height);
  return clampPosition(
    {
      x: bounds.left + clamp(position.xRatio, 0, 1) * xRange,
      y: bounds.top + clamp(position.yRatio, 0, 1) * yRange,
    },
    controlSize,
    bounds,
  );
}

export function resolvePanelPlacement(
  anchor: FloatingBounds,
  panelSize: FloatingSize,
  bounds: FloatingBounds,
  gap = 10,
): FloatingPanelPlacement {
  const safeGap = Math.max(0, finiteOrZero(gap));
  const boundsWidth = Math.max(0, bounds.right - bounds.left);
  const panelWidth = Math.min(
    Math.max(0, finiteOrZero(panelSize.width)),
    boundsWidth,
  );
  const desiredHeight = Math.max(0, finiteOrZero(panelSize.height));
  const spaceBelow = Math.max(0, bounds.bottom - anchor.bottom - safeGap);
  const spaceAbove = Math.max(0, anchor.top - bounds.top - safeGap);
  const vertical =
    desiredHeight <= spaceBelow || spaceBelow >= spaceAbove ? "below" : "above";
  const maxHeight = vertical === "below" ? spaceBelow : spaceAbove;
  const renderedHeight = Math.min(desiredHeight, maxHeight);
  const anchorCenter = (anchor.left + anchor.right) / 2;
  const boundsCenter = (bounds.left + bounds.right) / 2;
  const horizontal = anchorCenter <= boundsCenter ? "left" : "right";
  const preferredLeft =
    horizontal === "left" ? anchor.left : anchor.right - panelWidth;
  const left = clamp(preferredLeft, bounds.left, bounds.right - panelWidth);
  const preferredTop =
    vertical === "below"
      ? anchor.bottom + safeGap
      : anchor.top - safeGap - renderedHeight;
  const top = clamp(preferredTop, bounds.top, bounds.bottom - renderedHeight);

  return {
    left,
    top,
    maxWidth: boundsWidth,
    maxHeight,
    vertical,
    horizontal,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): NormalizedFloatingPosition | null {
  if (!isRecord(value)) return null;
  const { xRatio, yRatio } = value;
  if (
    typeof xRatio !== "number" ||
    typeof yRatio !== "number" ||
    !Number.isFinite(xRatio) ||
    !Number.isFinite(yRatio) ||
    xRatio < 0 ||
    xRatio > 1 ||
    yRatio < 0 ||
    yRatio > 1
  ) {
    return null;
  }
  return { xRatio, yRatio };
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadFloatingControlPositions(
  storage?: Storage | null,
): FloatingControlStorageLoadResult {
  const target = resolveStorage(storage);
  if (!target) return { positions: {}, canWrite: false };

  let raw: string | null;
  try {
    raw = target.getItem(FLOATING_CONTROLS_STORAGE_KEY);
  } catch {
    return { positions: {}, canWrite: false };
  }
  if (!raw) return { positions: {}, canWrite: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { positions: {}, canWrite: true };
  }
  if (!isRecord(parsed)) return { positions: {}, canWrite: true };
  if (typeof parsed.schemaVersion === "number" && parsed.schemaVersion > 1) {
    return { positions: {}, canWrite: false };
  }
  if (parsed.schemaVersion !== 1 || !isRecord(parsed.positions)) {
    return { positions: {}, canWrite: true };
  }

  const positions: FloatingControlStorageLoadResult["positions"] = {};
  for (const id of ["appearance", "musicPlayer"] as const) {
    const position = parsePosition(parsed.positions[id]);
    if (position) positions[id] = position;
  }
  return { positions, canWrite: true };
}

export function saveFloatingControlPosition(
  id: FloatingControlId,
  position: NormalizedFloatingPosition,
  storage?: Storage | null,
): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  const parsedPosition = parsePosition(position);
  if (!parsedPosition) return false;
  const loaded = loadFloatingControlPositions(target);
  if (!loaded.canWrite) return false;

  const next: StoredFloatingControlPositionsV1 = {
    schemaVersion: 1,
    positions: {
      ...loaded.positions,
      [id]: parsedPosition,
    },
  };
  try {
    target.setItem(FLOATING_CONTROLS_STORAGE_KEY, JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}
