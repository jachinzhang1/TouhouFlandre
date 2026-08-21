import { expect, test, type Page } from "@playwright/test";
import {
  chooseTrackView,
  getTrackCheckbox,
  MUSIC_AUDIO_SELECTOR,
  openTrackList,
  readCurrentTrackTitle,
  readPlaylistCount,
  readTrackList,
} from "./music-player-test-helpers";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';

async function openCard(page: Page) {
  await page.locator(LAUNCHER_SELECTOR).click();
  await expect(
    page.locator(`${CARD_SELECTOR}[data-open="true"]`),
  ).toBeVisible();
}

async function openPlaylist(page: Page) {
  const card = page.locator(CARD_SELECTOR);
  if ((await card.getAttribute("data-open")) !== "true") await openCard(page);
  await card.getByRole("button", { name: "曲库设置", exact: true }).click();
  const dialog = page.locator('[data-music-playlist-dialog="true"]');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("MUS-006 playlist dialog and persistence", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("music-player-settings-test-reset"))
        return;
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
    const audio = page.locator(MUSIC_AUDIO_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0.05);

    const before = await audio.evaluate((element) => {
      const media = element as HTMLAudioElement;
      return {
        currentSrc: media.currentSrc,
        currentTime: media.currentTime,
        paused: media.paused,
      };
    });
    await openTrackList(card);
    const tracks = await readTrackList(card);
    const currentIndex = tracks.findIndex((track) => track.isCurrent);
    expect(currentIndex).toBeGreaterThanOrEqual(0);
    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await (await getTrackCheckbox(dialog, currentIndex)).uncheck();
    await dialog.getByRole("button", { name: /取消/ }).click();

    await expect(dialog).toBeHidden();
    await expect(
      card.getByRole("button", { name: "曲库设置", exact: true }),
    ).toBeFocused();
    const after = await audio.evaluate((element) => {
      const media = element as HTMLAudioElement;
      return {
        currentSrc: media.currentSrc,
        currentTime: media.currentTime,
        paused: media.paused,
      };
    });
    expect(after.currentSrc).toBe(before.currentSrc);
    expect(after.currentTime).toBeGreaterThanOrEqual(before.currentTime);
    expect(after.paused).toBe(false);
    expect(
      await page.evaluate(() =>
        localStorage.getItem("touhoufriberg:music-player"),
      ),
    ).toBeNull();
  });

  test("applies a selection, changes a removed current track and keeps playing intent", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    const audio = page.locator(MUSIC_AUDIO_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();

    await openTrackList(card);
    const tracks = await readTrackList(card);
    if (tracks.length < 2) {
      test.skip(true, "requires at least two enabled tracks");
      return;
    }
    const currentIndex = tracks.findIndex((track) => track.isCurrent);
    const removedTrack = tracks[currentIndex];
    if (!removedTrack) throw new Error("The player has no current track.");
    const beforeSource = await audio.getAttribute("src");
    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await (await getTrackCheckbox(dialog, currentIndex)).uncheck();
    await dialog.getByRole("button", { name: /应用/ }).click();

    await expect(dialog).toBeHidden();
    await expect(
      card.getByRole("button", { name: "曲库设置", exact: true }),
    ).toBeFocused();
    const updatedTracks = await readTrackList(card);
    const updatedCurrent = updatedTracks.find((track) => track.isCurrent);
    if (!updatedCurrent)
      throw new Error("The player did not select a replacement track.");
    expect(updatedCurrent.id).not.toBe(removedTrack.id);
    await expect(card.getByRole("heading")).toContainText(updatedCurrent.title);
    await expect(
      card.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect(audio).not.toHaveAttribute("src", beforeSource ?? "");
  });

  test("refreshes an expanded inline list after applying enabled tracks", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await openTrackList(card);
    const initialTracks = await readTrackList(card);
    const initialTrackCount = initialTracks.length;
    if (initialTrackCount < 2) {
      test.skip(true, "requires at least two enabled tracks");
      return;
    }
    const currentIndex = initialTracks.findIndex((track) => track.isCurrent);
    const removedTrack = initialTracks[currentIndex];
    if (!removedTrack) throw new Error("The player has no current track.");

    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await (await getTrackCheckbox(dialog, currentIndex)).uncheck();
    await dialog.getByRole("button", { name: /应用/ }).click();

    await expect(dialog).toBeHidden();
    await expect(card.locator(".music-player-track-list-item")).toHaveCount(
      initialTrackCount - 1,
    );
    await expect(
      card.locator(`[data-music-player-track-id="${removedTrack.id}"]`),
    ).toHaveCount(0);
  });

  test("restores custom selection and volume preferences after refresh without autoplay", async ({
    page,
  }) => {
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    const audio = page.locator(MUSIC_AUDIO_SELECTOR);
    await openTrackList(card);
    const tracks = await readTrackList(card);
    if (tracks.length < 2) {
      test.skip(true, "requires at least two enabled tracks");
      return;
    }
    const currentIndex = tracks.findIndex((track) => track.isCurrent);
    const removedTrack = tracks[currentIndex];
    if (!removedTrack) throw new Error("The player has no current track.");
    const dialog = await openPlaylist(page);
    await chooseTrackView(dialog);
    await (await getTrackCheckbox(dialog, currentIndex)).uncheck();
    await dialog.getByRole("button", { name: /应用/ }).click();

    const updatedTracks = await readTrackList(card);
    const restoredTrack = updatedTracks.find((track) => track.isCurrent);
    if (!restoredTrack)
      throw new Error("The player did not restore a current track.");
    expect(restoredTrack.id).not.toBe(removedTrack.id);
    const restoredTitle = await readCurrentTrackTitle(card);
    expect(restoredTitle).toBe(restoredTrack.title);

    await card.getByRole("button", { name: "静音" }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem("touhoufriberg:music-player");
          return raw ? JSON.parse(raw).currentTrackId : null;
        }),
      )
      .toBe(restoredTrack.id);
    const restoredSource = await audio.getAttribute("src");
    await page.reload();
    await expect(audio).toHaveJSProperty("paused", true);
    await expect(audio).toHaveJSProperty("currentTime", 0);
    await expect(audio).toHaveAttribute("src", restoredSource ?? "");

    await openCard(page);
    await expect(
      page.locator(CARD_SELECTOR).getByRole("heading"),
    ).toContainText(restoredTitle);
    const restoredDialog = await openPlaylist(page);
    const restoredCount = await readPlaylistCount(restoredDialog);
    expect(restoredCount.selected).toBe(restoredCount.total - 1);
    await chooseTrackView(restoredDialog);
    await expect(
      await getTrackCheckbox(restoredDialog, currentIndex),
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
    const count = await readPlaylistCount(dialog);
    expect(count.selected).toBe(count.total);
    expect(count.total).toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
});
