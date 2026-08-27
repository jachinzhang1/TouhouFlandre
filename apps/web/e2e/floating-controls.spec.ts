import { expect, test, type Locator, type Page } from "@playwright/test";

const APPEARANCE_SELECTOR = ".appearance-toggle";
const MUSIC_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';
const STORAGE_KEY = "touhoufriberg:floating-controls";

async function dragControl(page: Page, control: Locator, x: number, y: number) {
  const box = await control.boundingBox();
  if (!box) throw new Error("Floating control is not measurable.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.up();
}

async function expectInsideBoundary(page: Page, control: Locator) {
  const result = await control.evaluate((element) => {
    const controlBox = element.getBoundingClientRect();
    const boundary = element.closest("[data-floating-control-boundary]");
    if (!boundary) throw new Error("Floating boundary is missing.");
    const boundaryBox = boundary.getBoundingClientRect();
    return {
      control: {
        left: controlBox.left,
        top: controlBox.top,
        right: controlBox.right,
        bottom: controlBox.bottom,
      },
      boundary: {
        left: boundaryBox.left,
        top: boundaryBox.top,
        right: boundaryBox.right,
        bottom: boundaryBox.bottom,
      },
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    };
  });
  expect(result.control.left).toBeGreaterThanOrEqual(
    result.boundary.left - 0.5,
  );
  expect(result.control.top).toBeGreaterThanOrEqual(result.boundary.top - 0.5);
  expect(result.control.right).toBeLessThanOrEqual(result.boundary.right + 0.5);
  expect(result.control.bottom).toBeLessThanOrEqual(
    result.boundary.bottom + 0.5,
  );
  expect(result.scrollWidth).toBeLessThanOrEqual(result.viewportWidth);
}

async function expectPanelInsideBoundary(panel: Locator, control: Locator) {
  const bounds = await Promise.all([
    panel.boundingBox(),
    control.evaluate((element) => {
      const boundary = element.closest("[data-floating-control-boundary]");
      if (!boundary) throw new Error("Floating boundary is missing.");
      const box = boundary.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
      };
    }),
  ]);
  const panelBox = bounds[0];
  const boundaryBox = bounds[1];
  expect(panelBox).not.toBeNull();
  expect(panelBox!.x).toBeGreaterThanOrEqual(boundaryBox.left - 0.5);
  expect(panelBox!.y).toBeGreaterThanOrEqual(boundaryBox.top - 0.5);
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(
    boundaryBox.right + 0.5,
  );
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(
    boundaryBox.bottom + 0.5,
  );
}

test.describe("draggable floating controls", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript((storageKey) => {
      if (window.sessionStorage.getItem("floating-controls-cleared")) return;
      window.localStorage.removeItem(storageKey);
      window.sessionStorage.setItem("floating-controls-cleared", "true");
    }, STORAGE_KEY);
    await page.goto("/");
    await expect(page.locator(MUSIC_SELECTOR)).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test("drags both controls independently without activating their click actions", async ({
    page,
  }) => {
    const appearance = page.locator(APPEARANCE_SELECTOR);
    const music = page.locator(MUSIC_SELECTOR);
    const initialMode = await page
      .locator("html")
      .getAttribute("data-theme-mode");

    await dragControl(page, appearance, 1, 1);
    await expectInsideBoundary(page, appearance);
    await expect(page.locator("html")).toHaveAttribute(
      "data-theme-mode",
      initialMode!,
    );

    const viewport = page.viewportSize()!;
    await dragControl(page, music, viewport.width - 1, viewport.height - 1);
    await expectInsideBoundary(page, music);
    await expect(music).toHaveAttribute("aria-expanded", "false");

    const stored = await page.evaluate((storageKey) => {
      return JSON.parse(window.localStorage.getItem(storageKey) ?? "null");
    }, STORAGE_KEY);
    expect(stored).toMatchObject({
      schemaVersion: 1,
      positions: {
        appearance: { xRatio: 0, yRatio: 0 },
        musicPlayer: { xRatio: 1, yRatio: 1 },
      },
    });
  });

  test("restores relative positions and clamps them after a viewport change", async ({
    page,
  }) => {
    const appearance = page.locator(APPEARANCE_SELECTOR);
    const music = page.locator(MUSIC_SELECTOR);
    await dragControl(page, appearance, 120, 180);
    await dragControl(page, music, 280, 240);
    const beforeReload = await Promise.all([
      appearance.boundingBox(),
      music.boundingBox(),
    ]);

    await page.reload();
    await expect(page.locator(MUSIC_SELECTOR)).toHaveCount(1, {
      timeout: 10_000,
    });
    const afterReload = await Promise.all([
      appearance.boundingBox(),
      music.boundingBox(),
    ]);
    expect(
      Math.abs(afterReload[0]!.x - beforeReload[0]!.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(afterReload[0]!.y - beforeReload[0]!.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(afterReload[1]!.x - beforeReload[1]!.x),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(afterReload[1]!.y - beforeReload[1]!.y),
    ).toBeLessThanOrEqual(1);

    await page.setViewportSize({ width: 320, height: 640 });
    await expectInsideBoundary(page, appearance);
    await expectInsideBoundary(page, music);
  });

  test("keeps the palette and player card inside the safe boundary near corners", async ({
    page,
  }) => {
    const appearance = page.locator(APPEARANCE_SELECTOR);
    await dragControl(page, appearance, 1, 1);
    await appearance.hover();
    const palette = page.locator(".appearance-palette");
    await expect(palette).toBeVisible();
    await expectPanelInsideBoundary(palette, appearance);

    const music = page.locator(MUSIC_SELECTOR);
    const viewport = page.viewportSize()!;
    await dragControl(page, music, viewport.width - 1, viewport.height - 1);
    await music.click();
    const card = page.locator(`${CARD_SELECTOR}[data-open="true"]`);
    await expect(card).toBeVisible();
    await expectPanelInsideBoundary(card, music);

    await dragControl(page, music, 1, 1);
    await expect(music).toHaveAttribute("aria-expanded", "true");
    await expect(card).toBeVisible();
    await expectPanelInsideBoundary(card, music);
  });
});
