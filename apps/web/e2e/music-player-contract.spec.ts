import { expect, test } from "@playwright/test";

const AUDIO_SELECTOR = '[data-music-player-audio="true"]';

test.describe("MUS-001 root audio boundary", () => {
  test("keeps one audio host across soft navigation and replaces it on reload", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(page.locator(AUDIO_SELECTOR)).toHaveCount(1);
    await page.evaluate((selector) => {
      const audio = document.querySelector<HTMLAudioElement>(selector);
      if (!audio) throw new Error("Music player audio host is missing.");

      // Keep the media local to the browser test. This is an eight-second PCM WAV
      // generated in memory and is never written to the repository.
      const sampleRate = 8_000;
      const data = new Uint8Array(sampleRate * 8).fill(128);
      const buffer = new ArrayBuffer(44 + data.length);
      const view = new DataView(buffer);
      const writeText = (offset: number, value: string) => {
        for (let index = 0; index < value.length; index += 1) {
          view.setUint8(offset + index, value.charCodeAt(index));
        }
      };
      writeText(0, "RIFF");
      view.setUint32(4, 36 + data.length, true);
      writeText(8, "WAVE");
      writeText(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate, true);
      view.setUint16(32, 1, true);
      view.setUint16(34, 8, true);
      writeText(36, "data");
      view.setUint32(40, data.length, true);
      new Uint8Array(buffer, 44).set(data);

      const events: string[] = [];
      for (const type of [
        "loadstart",
        "durationchange",
        "loadedmetadata",
        "canplay",
        "play",
        "timeupdate",
        "seeking",
        "seeked",
        "volumechange",
        "pause",
        "ended",
        "error",
      ]) {
        audio.addEventListener(type, () => events.push(type));
      }
      audio.src = URL.createObjectURL(
        new Blob([buffer], { type: "audio/wav" }),
      );
      audio.muted = true;
      const probeWindow = window as Window & {
        __musicPlayerAudio?: HTMLAudioElement;
        __musicPlayerEvents?: string[];
      };
      probeWindow.__musicPlayerAudio = audio;
      probeWindow.__musicPlayerEvents = events;
    }, AUDIO_SELECTOR);
    await page.locator(AUDIO_SELECTOR).evaluate(async (audio) => {
      await (audio as HTMLAudioElement).play();
    });
    await expect
      .poll(() =>
        page
          .locator(AUDIO_SELECTOR)
          .evaluate((audio) => (audio as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0.1);
    await page.locator(AUDIO_SELECTOR).evaluate((element) => {
      const audio = element as HTMLAudioElement;
      audio.volume = 0.4;
      audio.currentTime = 0.5;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const events = (window as Window & { __musicPlayerEvents?: string[] })
            .__musicPlayerEvents;
          return ["volumechange", "seeking", "seeked"].every((event) =>
            events?.includes(event),
          );
        }),
      )
      .toBe(true);
    const beforeNavigation = await page
      .locator(AUDIO_SELECTOR)
      .evaluate((element) => {
        const audio = element as HTMLAudioElement;
        return {
          currentSrc: audio.currentSrc,
          currentTime: audio.currentTime,
          paused: audio.paused,
        };
      });
    const beforeNavigationEvents = await page.evaluate(
      () =>
        (window as Window & { __musicPlayerEvents?: string[] })
          .__musicPlayerEvents ?? [],
    );
    const eventIndex = (type: string) => beforeNavigationEvents.indexOf(type);
    expect(eventIndex("loadstart")).toBeGreaterThanOrEqual(0);
    expect(eventIndex("loadedmetadata")).toBeGreaterThan(
      eventIndex("loadstart"),
    );
    expect(eventIndex("canplay")).toBeGreaterThan(eventIndex("loadedmetadata"));
    expect(eventIndex("timeupdate")).toBeGreaterThan(eventIndex("play"));

    await page.getByRole("link", { name: "搜索" }).click();
    await expect(page).toHaveURL((url) => url.pathname === "/search");
    await expect(page.locator(AUDIO_SELECTOR)).toHaveCount(1);
    const afterSearchNavigation = await page.evaluate((selector) => {
      const expected = (
        window as Window & { __musicPlayerAudio?: HTMLAudioElement }
      ).__musicPlayerAudio;
      const current = document.querySelector<HTMLAudioElement>(selector);
      return {
        sameElement: expected === current,
        currentSrc: current?.currentSrc,
        currentTime: current?.currentTime,
        paused: current?.paused,
      };
    }, AUDIO_SELECTOR);
    expect(afterSearchNavigation.sameElement).toBe(true);
    expect(afterSearchNavigation.currentSrc).toBe(beforeNavigation.currentSrc);
    expect(afterSearchNavigation.currentTime).toBeGreaterThanOrEqual(
      beforeNavigation.currentTime,
    );
    expect(afterSearchNavigation.paused).toBe(false);
    const afterNavigationEvents = await page.evaluate(
      () =>
        (window as Window & { __musicPlayerEvents?: string[] })
          .__musicPlayerEvents ?? [],
    );
    expect(
      afterNavigationEvents.filter((type) => type === "loadstart"),
    ).toHaveLength(
      beforeNavigationEvents.filter((type) => type === "loadstart").length,
    );
    expect(
      afterNavigationEvents.filter((type) => type === "pause"),
    ).toHaveLength(
      beforeNavigationEvents.filter((type) => type === "pause").length,
    );
    expect(await page.locator(AUDIO_SELECTOR).getAttribute("preload")).toBe(
      "metadata",
    );

    // Next's development indicator overlaps the first mobile nav item.
    await page
      .getByRole("link", { name: "首页", exact: true })
      .evaluate((link: HTMLAnchorElement) => link.click());
    await expect(page).toHaveURL((url) => url.pathname === "/");
    expect(
      await page.evaluate((selector) => {
        const expected = (
          window as Window & { __musicPlayerAudio?: HTMLAudioElement }
        ).__musicPlayerAudio;
        return expected === document.querySelector(selector);
      }, AUDIO_SELECTOR),
    ).toBe(true);

    await page.reload();
    await expect(page.locator(AUDIO_SELECTOR)).toHaveCount(1);
    expect(
      await page.evaluate((selector) => {
        const previous = (
          window as Window & { __musicPlayerAudio?: HTMLAudioElement }
        ).__musicPlayerAudio;
        return previous === document.querySelector(selector);
      }, AUDIO_SELECTOR),
    ).toBe(false);
    expect(await page.locator(AUDIO_SELECTOR).getAttribute("src")).toBeNull();
    await expect(page.locator(AUDIO_SELECTOR)).toHaveJSProperty("paused", true);
    await expect(page.locator(AUDIO_SELECTOR)).toHaveJSProperty(
      "currentTime",
      0,
    );
  });
});
