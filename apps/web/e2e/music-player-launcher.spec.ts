import { expect, test } from "@playwright/test";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const THEME_COLORS = ["scarlet", "sakura", "iris", "jade", "amber", "azure"];

test.describe("MUS-004 floating player launcher", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("touhoufriberg:appearance");
    });
    await page.goto("/");
    await expect(page.locator(LAUNCHER_SELECTOR)).toHaveCount(1);
  });

  test("exposes a centered music note and toggles the reserved card state", async ({
    page,
  }) => {
    const launcher = page.locator(LAUNCHER_SELECTOR);
    await expect(launcher.locator(".music-player-launcher-icon")).toHaveCount(1);
    await expect(launcher).toHaveAttribute("aria-expanded", "false");
    await expect(launcher).toHaveAttribute("aria-controls", "music-player-card");

    await launcher.focus();
    await expect(launcher).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Space");
    await expect(launcher).toHaveAttribute("aria-expanded", "false");
  });

  test("uses the active accent for progress in every theme", async ({ page }) => {
    const launcher = page.locator(LAUNCHER_SELECTOR);
    const progressRing = launcher.locator(".music-player-launcher-ring-progress");

    for (const color of THEME_COLORS) {
      await page.evaluate((nextColor) => {
        document.documentElement.dataset.themeColor = nextColor;
      }, color);
      const colors = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.appendChild(probe);
        const resolvedAccent = getComputedStyle(probe).color;
        probe.remove();
        return {
          progress: getComputedStyle(
            document.querySelector(".music-player-launcher-ring-progress")!,
          ).stroke,
          resolvedAccent,
        };
      });
      expect(colors.progress).toBe(colors.resolvedAccent);
    }
  });

  test("stays within the viewport and below the desktop navigation", async ({
    page,
  }) => {
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 1024, height: 900 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      const layout = await page.evaluate((selector) => {
        const launcher = document.querySelector<HTMLElement>(selector);
        const nav = document.querySelector<HTMLElement>("nav");
        if (!launcher || !nav) throw new Error("Launcher or site navigation is missing.");
        const launcherBox = launcher.getBoundingClientRect();
        const navBox = nav.getBoundingClientRect();
        return {
          left: launcherBox.left,
          right: launcherBox.right,
          top: launcherBox.top,
          viewportWidth: window.innerWidth,
          navBottom: navBox.bottom,
          scrollWidth: document.documentElement.scrollWidth,
        };
      }, LAUNCHER_SELECTOR);

      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
      if (viewport.width >= 1024) {
        expect(layout.top).toBeGreaterThanOrEqual(layout.navBottom);
      }
    }
  });
});
