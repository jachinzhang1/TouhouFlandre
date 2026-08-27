import { expect, test, type Page, type TestInfo } from "@playwright/test";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';

async function openCard(page: Page) {
  const launcher = page.locator(LAUNCHER_SELECTOR);
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`${CARD_SELECTOR}[data-open="true"]`),
  ).toBeVisible();
}

test.describe("MUS-007 accessibility and responsive acceptance", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem("touhoufriberg:appearance");
      window.localStorage.removeItem("touhoufriberg:music-player");
    });
    await page.goto("/");
    await expect(page.locator(LAUNCHER_SELECTOR)).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test("completes the player and playlist flow with keyboard focus restoration", async ({
    page,
  }) => {
    const launcher = page.locator(LAUNCHER_SELECTOR);
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);

    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await expect(launcher).toHaveAttribute(
      "aria-controls",
      "music-player-card",
    );
    await expect(card).toHaveAttribute("aria-hidden", "false");

    const play = card.getByRole("button", { name: "播放", exact: true });
    await play.focus();
    await page.keyboard.press("Space");
    await expect(
      card.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Space");
    await expect(
      card.getByRole("button", { name: "播放", exact: true }),
    ).toBeVisible();

    const progress = card.getByRole("slider", { name: "播放进度" });
    const volume = card.getByRole("slider", { name: "音量" });
    await expect(progress).toBeEnabled({ timeout: 10_000 });
    await progress.focus();
    const beforeProgress = await progress.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect(progress).not.toHaveAttribute(
      "aria-valuenow",
      beforeProgress ?? "",
    );
    await volume.focus();
    await page.keyboard.press("ArrowLeft");

    const playlistButton = card.getByRole("button", {
      name: "曲库设置",
      exact: true,
    });
    await playlistButton.focus();
    await page.keyboard.press("Enter");
    const dialog = page.locator('[data-music-playlist-dialog="true"]');
    await expect(dialog).toBeVisible();
    const modal = page.locator('[role="dialog"]');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAccessibleName("调整曲目列表");

    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab");
    }
    expect(
      await page.evaluate(() => {
        const active = document.activeElement;
        return Boolean(active && active.closest('[role="dialog"]'));
      }),
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(playlistButton).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("aria-hidden", "true");
    await expect(launcher).toBeFocused();
  });

  test("honors reduced motion and keeps a narrow viewport free of overflow", async ({
    page,
  }, testInfo: TestInfo) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.reload();
    await openCard(page);

    const motion = await page.locator(CARD_SELECTOR).evaluate((card) => {
      const style = getComputedStyle(card);
      const marquee = card.querySelector<HTMLElement>(
        ".music-player-marquee-track",
      );
      return {
        transitionDuration: style.transitionDuration,
        marqueeAnimationDuration: marquee
          ? getComputedStyle(marquee).animationDuration
          : "0s",
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });
    expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(
      0.02,
    );
    expect(
      Number.parseFloat(motion.marqueeAnimationDuration),
    ).toBeLessThanOrEqual(0.02);
    expect(motion.scrollWidth).toBeLessThanOrEqual(motion.viewportWidth);

    await page.screenshot({
      path: testInfo.outputPath("music-player-mobile-reduced-motion.png"),
      fullPage: true,
    });
  });
});
