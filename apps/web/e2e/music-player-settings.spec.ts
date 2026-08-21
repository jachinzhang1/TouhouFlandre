import { expect, test, type Page } from "@playwright/test";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';
const AUDIO_SELECTOR = '[data-music-player-audio="true"]';
const FIRST_TITLE = "女仆与血之怀表";
const SECOND_TITLE = "广有射怪鸟事 ～ Till When?";

async function openCard(page: Page) {
  await page.locator(LAUNCHER_SELECTOR).click();
  await expect(page.locator(`${CARD_SELECTOR}[data-open="true"]`)).toBeVisible();
}

async function openPlaylist(page: Page) {
  const card = page.locator(CARD_SELECTOR);
  if ((await card.getAttribute("data-open")) !== "true") await openCard(page);
  await card.getByRole("button", { name: "曲库设置", exact: true }).click();
  const dialog = page.locator('[data-music-playlist-dialog="true"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseTrackView(dialog: ReturnType<Page["locator"]>) {
  await dialog.getByText("按曲目", { exact: true }).click();
  await expect(
    dialog.getByRole("checkbox", { name: `选择《${FIRST_TITLE}》` }),
  ).toBeVisible();
}

test.describe("MUS-006 playlist dialog and persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("music-player-settings-test-reset")) return;
      window.sessionStorage.setItem("music-player-settings-test-reset", "1");
      window.localStorage.removeItem("touhoufriberg:appearance");
      window.localStorage.removeItem("touhoufriberg:music-player");
    });
    await page.goto("/");
    await expect(page.locator(LAUNCHER_SELECTOR)).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test("cancel keeps the playing source and does not write storage", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(card.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect
      .poll(() =>
        page.locator(AUDIO_SELECTOR).evaluate((element) =>
          (element as HTMLAudioElement).currentTime,
        ),
      )
      .toBeGreaterThan(0.05);

    const before = await page.locator(AUDIO_SELECTOR).evaluate((element) => {
      const audio = element as HTMLAudioElement;
      return {
        currentSrc: audio.currentSrc,
        currentTime: audio.currentTime,
        paused: audio.paused,
      };
    });
    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await dialog.getByRole("checkbox", { name: `选择《${FIRST_TITLE}》` }).uncheck();
    await dialog.getByRole("button", { name: /取消/ }).click();

    await expect(dialog).toBeHidden();
    await expect(card.getByRole("button", { name: "曲库设置", exact: true })).toBeFocused();
    const after = await page.locator(AUDIO_SELECTOR).evaluate((element) => {
      const audio = element as HTMLAudioElement;
      return {
        currentSrc: audio.currentSrc,
        currentTime: audio.currentTime,
        paused: audio.paused,
      };
    });
    expect(after.currentSrc).toBe(before.currentSrc);
    expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime);
    expect(after.paused).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("touhoufriberg:music-player"))).toBeNull();
  });

  test("applies a selection, changes a removed current track and keeps playing intent", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(card.getByRole("button", { name: "暂停", exact: true })).toBeVisible();

    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await dialog.getByRole("checkbox", { name: `选择《${FIRST_TITLE}》` }).uncheck();
    await dialog.getByRole("button", { name: /应用/ }).click();

    await expect(dialog).toBeHidden();
    await expect(card.getByRole("button", { name: "曲库设置", exact: true })).toBeFocused();
    await expect(card.getByRole("heading")).toContainText(SECOND_TITLE);
    await expect(card.getByRole("button", { name: "暂停", exact: true })).toBeVisible();
    await expect(page.locator(AUDIO_SELECTOR)).toHaveAttribute(
      "src",
      /gensoukyoku-bassui-day-12\.mp3/,
    );
  });

  test("restores custom selection and volume preferences after refresh without autoplay", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await dialog.getByRole("checkbox", { name: `选择《${FIRST_TITLE}》` }).uncheck();
    await dialog.getByRole("button", { name: /应用/ }).click();
    await expect(card.getByRole("heading")).toContainText(SECOND_TITLE);

    await card.getByRole("button", { name: "静音" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("touhoufriberg:music-player");
          return raw ? JSON.parse(raw).currentTrackId : null;
        }),
      )
      .toBe("gensoukyoku-bassui-day-12");
    await page.reload();
    await expect(page.locator(AUDIO_SELECTOR)).toHaveJSProperty("paused", true);
    await expect(page.locator(AUDIO_SELECTOR)).toHaveJSProperty("currentTime", 0);
    await expect(page.locator(AUDIO_SELECTOR)).toHaveAttribute(
      "src",
      /gensoukyoku-bassui-day-12\.mp3/,
    );

    await openCard(page);
    await expect(page.locator(CARD_SELECTOR).getByRole("heading")).toContainText(
      SECOND_TITLE,
    );
    const restoredDialog = await openPlaylist(page);
    await expect(restoredDialog.getByText("已选择 2 / 3 首")).toBeVisible();
    await chooseTrackView(restoredDialog);
    await expect(
      restoredDialog.getByRole("checkbox", { name: `选择《${FIRST_TITLE}》` }),
    ).not.toBeChecked();
  });

  test("repairs damaged storage and keeps the dialog inside the viewport", async ({
    page,
  }) => {
    await page.evaluate(() => {
      localStorage.setItem("touhoufriberg:music-player", "{broken");
    });
    await page.reload();
    const dialog = await openPlaylist(page);
    await expect(dialog.getByText("已选择 3 / 3 首")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
});
