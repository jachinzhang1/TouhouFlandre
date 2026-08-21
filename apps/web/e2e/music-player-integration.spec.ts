import { expect, test, type Page } from "@playwright/test";
import {
  MUSIC_AUDIO_SELECTOR,
  MUSIC_TRACK_SOURCE_PATTERN,
} from "./music-player-test-helpers";

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

async function closeCard(page: Page) {
  const launcher = page.locator(LAUNCHER_SELECTOR);
  await launcher.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator(`${CARD_SELECTOR}[data-open="false"]`),
  ).toHaveAttribute("aria-hidden", "true");
}

async function navigateViaClientLink(page: Page, selector: string) {
  const link = page.locator(selector).first();
  await expect(link).toBeVisible();
  await link.evaluate((element) => (element as HTMLAnchorElement).click());
}

async function resetPlayerStorage(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("touhoufriberg:appearance");
    window.localStorage.removeItem("touhoufriberg:music-player");
  });
}

test.describe("MUS-007 cross-module integration", () => {
  test.beforeEach(async ({ page }) => {
    await resetPlayerStorage(page);
    await page.goto("/");
    await expect(page.locator(LAUNCHER_SELECTOR)).toHaveCount(1, {
      timeout: 10_000,
    });
  });

  test("keeps one playing audio instance across routes and stops only on refresh", async ({
    page,
  }) => {
    const audio = page.locator(MUSIC_AUDIO_SELECTOR);
    await expect(audio).toHaveCount(1);
    await expect(audio).toHaveAttribute("preload", "metadata");
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentSrc),
      )
      .toMatch(MUSIC_TRACK_SOURCE_PATTERN);

    await page.evaluate((selector) => {
      const element = document.querySelector<HTMLAudioElement>(selector);
      if (!element) throw new Error("Music audio element is missing.");
      const events = { loadstart: 0, pause: 0 };
      element.addEventListener("loadstart", () => events.loadstart++);
      element.addEventListener("pause", () => events.pause++);
      const lifecycle = window as Window & {
        __musicPlayerLifecycle?: {
          audio: HTMLAudioElement;
          events: typeof events;
        };
      };
      lifecycle.__musicPlayerLifecycle = { audio: element, events };
    }, MUSIC_AUDIO_SELECTOR);

    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        audio.evaluate((element) => (element as HTMLAudioElement).currentTime),
      )
      .toBeGreaterThan(0.1);

    const beforeNavigation = await audio.evaluate((element) => ({
      currentSrc: (element as HTMLAudioElement).currentSrc,
      currentTime: (element as HTMLAudioElement).currentTime,
    }));

    const routes = [
      { selector: 'nav a[href="/search"]', href: "/search" },
      { selector: 'nav a[href="/single"]', href: "/single" },
      { selector: 'a[href="/multi"]', href: "/multi" },
      { selector: 'nav a[href="/stats"]', href: "/stats" },
      { selector: 'nav a[href="/announcement"]', href: "/announcement" },
    ];
    for (const route of routes) {
      await closeCard(page);
      await navigateViaClientLink(page, route.selector);
      await expect(page).toHaveURL(
        new RegExp(`${route.href.replace("/", "\\/")}(?:$|\\?)`),
      );
      await expect(audio).toHaveCount(1);
      const state = await page.evaluate((selector) => {
        const lifecycle = window as Window & {
          __musicPlayerLifecycle?: { audio: HTMLAudioElement; events: unknown };
        };
        const current = document.querySelector<HTMLAudioElement>(selector);
        return {
          sameElement: current === lifecycle.__musicPlayerLifecycle?.audio,
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
      await openCard(page);
    }

    const events = await page.evaluate(() => {
      const lifecycle = window as Window & {
        __musicPlayerLifecycle?: {
          audio: HTMLAudioElement;
          events: { loadstart: number; pause: number };
        };
      };
      return (
        lifecycle.__musicPlayerLifecycle?.events ?? { loadstart: 0, pause: 0 }
      );
    });
    expect(events.pause).toBe(0);

    const persistedSource = await audio.getAttribute("src");
    await page.reload();
    await expect(audio).toHaveCount(1, { timeout: 10_000 });
    await expect(audio).toHaveAttribute("src", persistedSource ?? "");
    await expect(audio).toHaveJSProperty("paused", true);
    await expect(audio).toHaveJSProperty("currentTime", 0);
  });

  test("keeps controls recoverable when the current audio fails", async ({
    page,
  }) => {
    const initialSource = await page
      .locator(MUSIC_AUDIO_SELECTOR)
      .getAttribute("src");
    expect(initialSource).toMatch(MUSIC_TRACK_SOURCE_PATTERN);
    await page.route(`**${initialSource}`, (route) => route.abort("failed"));
    await page.reload();
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);

    await expect(card.getByRole("alert")).toHaveText(/\S+/u);
    await expect(
      card.getByRole("button", { name: "下一首", exact: true }),
    ).toBeEnabled();
    await card.getByRole("button", { name: "下一首", exact: true }).click();
    await expect(page.locator(MUSIC_AUDIO_SELECTOR)).toHaveCount(1);
  });

  test("surfaces a rejected user play request without an unhandled page error", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.play = () =>
        Promise.reject(
          new DOMException("User gesture required", "NotAllowedError"),
        );
    });
    await page.reload();
    const launcher = page.locator(LAUNCHER_SELECTOR);
    await launcher.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.locator(`${CARD_SELECTOR}[data-open="true"]`),
    ).toBeVisible();
    const card = page.locator(CARD_SELECTOR);
    await card.getByRole("button", { name: "播放", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText(
      "User gesture required",
    );
    await expect(
      card.getByRole("button", { name: "播放", exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("keeps in-memory controls usable when local storage is unavailable", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));
    await page.addInitScript(() => {
      Object.defineProperty(Storage.prototype, "setItem", {
        configurable: true,
        value: () => {
          throw new Error("Storage is blocked");
        },
      });
    });
    await page.reload();
    await openCard(page);
    const card = page.locator(CARD_SELECTOR);
    await card.getByRole("button", { name: "静音", exact: true }).click();
    await expect(
      card.getByRole("button", { name: "取消静音", exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
