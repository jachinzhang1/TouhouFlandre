import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';
const THEME_COLORS = ["scarlet", "sakura", "iris", "jade", "amber", "azure"];

async function openCard(page: Page) {
  const launcher = page.locator(LAUNCHER_SELECTOR);
  await launcher.click();
  await expect(page.locator(`${CARD_SELECTOR}[data-open="true"]`)).toBeVisible();
}

async function commitProgressSeek(
  page: Page,
  progress: Locator,
  sliderRoot: Locator,
  testInfo: TestInfo,
) {
  const before = await progress.getAttribute("aria-valuenow");
  if (testInfo.project.name === "mobile-chromium") {
    const box = await sliderRoot.boundingBox();
    if (!box) throw new Error("Progress slider is not measurable.");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  } else {
    await progress.focus();
    await page.keyboard.press("ArrowRight");
  }
  await expect(progress).not.toHaveAttribute("aria-valuenow", before ?? "");
}

test.describe("MUS-005 player card", () => {
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

  test("renders the current track and controls the single audio instance", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);

    await expect(card.getByRole("heading")).toContainText("女仆与血之怀表");
    await expect(card.getByAltText("《女仆与血之怀表》封面")).toBeVisible();
    await expect(card.getByRole("slider", { name: "播放进度" })).toBeEnabled({
      timeout: 10_000,
    });
    await expect(page.locator('[data-music-player-audio="true"]')).toHaveCount(1);

    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(card.getByRole("button", { name: "暂停" })).toBeVisible();

    const audioState = await page.locator('[data-music-player-audio="true"]').evaluate(
      (audio) => ({ src: (audio as HTMLAudioElement).currentSrc, paused: (audio as HTMLAudioElement).paused }),
    );
    expect(audioState.src).toContain("/music/tracks/");
    expect(audioState.paused).toBe(false);

    await card.getByRole("button", { name: "下一首" }).click();
    await expect(card.getByRole("heading")).toContainText("广有射怪鸟事");
    await card.getByRole("button", { name: "静音" }).click();
    await expect(card.getByRole("button", { name: "取消静音" })).toBeVisible();
  });

  test("commits seek and restores focus after close", async ({ page }, testInfo) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    const progress = card.getByRole("slider", { name: "播放进度" });
    const progressRoot = card.locator(".music-player-card-progress .ant-slider");

    await expect(progress).toBeEnabled({ timeout: 10_000 });
    await commitProgressSeek(page, progress, progressRoot, testInfo);

    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("aria-hidden", "true");
    await expect(page.locator(LAUNCHER_SELECTOR)).toBeFocused();
  });

  test("closes on outside click and keeps the card inside the viewport", async ({ page }) => {
    for (const viewport of [
      { width: 320, height: 800 },
      { width: 1024, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await expect(page.locator(LAUNCHER_SELECTOR)).toHaveCount(1, {
        timeout: 10_000,
      });
      await openCard(page);

      const bounds = await page.locator(CARD_SELECTOR).boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect((await page.evaluate(() => document.documentElement.scrollWidth))).toBeLessThanOrEqual(
        viewport.width,
      );

      await page.mouse.click(8, viewport.height - 12);
      await expect(page.locator(CARD_SELECTOR)).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("uses the active accent for progress and volume tracks in every theme", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await expect(card.getByRole("slider", { name: "音量" })).toBeVisible();
    await expect(card.getByRole("slider", { name: "播放进度" })).toBeEnabled({
      timeout: 10_000,
    });
    await page.waitForTimeout(350);

    for (const color of THEME_COLORS) {
      await page.evaluate((nextColor) => {
        document.documentElement.dataset.themeColor = nextColor;
      }, color);
      await page.waitForTimeout(350);
      const colors = await page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent)";
        document.body.appendChild(probe);
        const accent = getComputedStyle(probe).color;
        probe.remove();
        return {
          accent,
          progress: getComputedStyle(
            document.querySelector(".music-player-card-progress .ant-slider-track")!,
          ).backgroundColor,
          volume: getComputedStyle(
            document.querySelector(".music-player-volume-control .ant-slider-track")!,
          ).backgroundColor,
        };
      });
      expect(colors.progress).toBe(colors.accent);
      expect(colors.volume).toBe(colors.accent);
    }
  });

  test("falls back to the local placeholder when the cover request fails", async ({
    page,
  }) => {
    await openCard(page);
    await page.route("**/music/missing-cover.png", (route) => route.abort());
    await page.locator(`${CARD_SELECTOR} img`).evaluate((image) => {
      image.setAttribute("src", "/music/missing-cover.png");
    });
    await expect(page.locator(`${CARD_SELECTOR} img`)).toHaveAttribute(
      "src",
      "/music/placeholder-cover.png",
    );
  });
});
