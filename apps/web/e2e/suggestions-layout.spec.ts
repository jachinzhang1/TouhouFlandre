import { expect, test } from "@playwright/test";

test.describe("single game suggestion layout", () => {
  test("search suggestions can float outside the game surface", async ({
    page,
  }) => {
    const session = {
      id: "layout-session",
      mode: "daily",
      contentType: "character",
      status: "playing",
      maxGuesses: 8,
      puzzleKey: "2026-08-06",
      guesses: [],
      startedAt: "2026-08-06T00:00:00.000Z",
    };

    await page.route("**/api/catalog", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ dailyDateKey: "2026-08-06", contents: [] }),
      });
    });

    await page.route("**/api/puzzles/daily", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          puzzleLabel: "Daily 2026-08-06",
          session,
        }),
      });
    });

    await page.route("**/api/characters/search?**", async (route) => {
      const results = Array.from({ length: 12 }, (_, index) => ({
        id: `layout_probe_${index}`,
        name: `Layout Probe ${index + 1}`,
        subtitle: "Layout regression probe",
        initials: "LP",
        avatarUrl: "/characters/layout-probe.png",
        appearanceOrder: index,
        firstAppearance: {
          workTitle: "Layout Test",
          releaseYear: 1996,
        },
        species: ["human"],
        locations: ["test"],
        affiliations: ["test"],
        hairColors: ["brown"],
      }));

      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results, total: results.length }),
      });
    });

    await page.goto("/single/daily");
    const input = page.locator(".search-box input");
    await expect(input).toBeEnabled();
    await input.fill("layout");

    const suggestionList = page.locator(".suggestion-list");
    await expect(suggestionList).toBeVisible();
    await expect(suggestionList.locator(".suggestion")).toHaveCount(12);

    await expect(async () => {
      const isFloating = await page.evaluate(() => {
        const surface = document.querySelector(".game-surface");
        const list = document.querySelector(".suggestion-list");
        if (!surface || !list) return false;

        const surfaceRect = surface.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const probeX = listRect.left + listRect.width / 2;
        const probeY = surfaceRect.bottom + 16;
        const hit = document.elementFromPoint(probeX, probeY);
        const surfaceOverflow = window.getComputedStyle(surface).overflow;

        return (
          surfaceOverflow === "visible" &&
          listRect.bottom > surfaceRect.bottom &&
          hit instanceof Element &&
          Boolean(hit.closest(".suggestion-list"))
        );
      });

      expect(isFloating).toBe(true);
    }).toPass();
  });
});
