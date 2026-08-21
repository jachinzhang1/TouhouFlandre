import { expect, test } from "@playwright/test";
import {
  MUSIC_AUDIO_SELECTOR,
  MUSIC_TRACK_SOURCE_PATTERN,
  openTrackList,
  readTrackList,
} from "./music-player-test-helpers";

const LAUNCHER_SELECTOR = '[data-music-player-launcher="true"]';
const CARD_SELECTOR = '[data-music-player-card="true"]';

type MusicLifecycleWindow = Window & {
  __musicLifecycleAudio?: HTMLAudioElement;
  __musicLifecycleEvents?: string[];
};

test.describe("MUS-003 persistent playback core", () => {
  test("loops real media and keeps one source playing across soft navigation", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.goto("/");

    const launcher = page.locator(LAUNCHER_SELECTOR);
    await launcher.click();
    const card = page.locator(CARD_SELECTOR);
    await expect(card).toHaveAttribute("data-open", "true");
    await openTrackList(card);
    const trackCount = (await readTrackList(card)).length;
    await launcher.click();
    await expect(card).toHaveAttribute("data-open", "false");

    const audio = page.locator(MUSIC_AUDIO_SELECTOR);
    await expect(audio).toHaveCount(1, { timeout: 10_000 });
    await expect(audio).toHaveAttribute("preload", "metadata");
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentSrc),
      )
      .toMatch(MUSIC_TRACK_SOURCE_PATTERN);
    const initialSource = await audio.evaluate(
      (element) => (element as HTMLAudioElement).currentSrc,
    );
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).duration),
      )
      .toBeGreaterThan(0);

    await audio.evaluate(async (element) => {
      const media = element as HTMLAudioElement;
      const lifecycleWindow = window as MusicLifecycleWindow;
      const events: string[] = [];
      for (const type of ["loadstart", "play", "pause", "ended", "error"]) {
        media.addEventListener(type, () => events.push(type));
      }
      lifecycleWindow.__musicLifecycleAudio = media;
      lifecycleWindow.__musicLifecycleEvents = events;
      media.muted = true;
      await media.play();
    });
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0.1);

    await audio.evaluate((element) => {
      const media = element as HTMLAudioElement;
      media.currentTime = Math.max(0, media.duration - 0.25);
    });
    const nextSourceAssertion = expect.poll(
      () =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentSrc),
      { timeout: 10_000 },
    );
    if (trackCount > 1) {
      await nextSourceAssertion.not.toBe(initialSource);
    } else {
      await nextSourceAssertion.toMatch(MUSIC_TRACK_SOURCE_PATTERN);
    }
    const nextSource = await audio.evaluate(
      (element) => (element as HTMLAudioElement).currentSrc,
    );
    expect(nextSource).toMatch(MUSIC_TRACK_SOURCE_PATTERN);
    expect(nextSource).not.toBe(initialSource);
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0.05);

    const beforeNavigation = await audio.evaluate((element) => ({
      currentSrc: (element as HTMLAudioElement).currentSrc,
      currentTime: (element as HTMLAudioElement).currentTime,
    }));
    const beforeEvents = await page.evaluate(
      () => (window as MusicLifecycleWindow).__musicLifecycleEvents ?? [],
    );

    for (const destination of ["搜索", "统计"]) {
      await page.getByRole("link", { name: destination, exact: true }).click();
      await expect(audio).toHaveCount(1);
      const state = await page.evaluate((selector) => {
        const lifecycleWindow = window as MusicLifecycleWindow;
        const current = document.querySelector<HTMLAudioElement>(selector);
        return {
          sameElement: current === lifecycleWindow.__musicLifecycleAudio,
          currentSrc: current?.currentSrc,
          currentTime: current?.currentTime ?? 0,
          paused: current?.paused,
        };
      }, MUSIC_AUDIO_SELECTOR);
      expect(state.sameElement).toBe(true);
      expect(state.currentSrc).toBe(beforeNavigation.currentSrc);
      expect(state.currentTime).toBeGreaterThanOrEqual(
        beforeNavigation.currentTime,
      );
      expect(state.paused).toBe(false);
    }

    const afterEvents = await page.evaluate(
      () => (window as MusicLifecycleWindow).__musicLifecycleEvents ?? [],
    );
    expect(afterEvents.filter((type) => type === "loadstart")).toHaveLength(
      beforeEvents.filter((type) => type === "loadstart").length,
    );
    expect(afterEvents.filter((type) => type === "pause")).toHaveLength(
      beforeEvents.filter((type) => type === "pause").length,
    );

    const persistedSource = await audio.getAttribute("src");
    await page.reload();
    await expect(audio).toHaveCount(1, { timeout: 10_000 });
    await expect.poll(() => audio.getAttribute("src")).toBe(persistedSource);
    await expect(audio).toHaveJSProperty("paused", true);
    await expect(audio).toHaveJSProperty("currentTime", 0);
    expect(pageErrors).toEqual([]);
  });
});
