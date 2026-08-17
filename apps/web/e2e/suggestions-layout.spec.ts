import { expect, test } from "@playwright/test";

test.describe.configure({ timeout: 90_000 });

test.describe("single game suggestion layout", () => {
  test("search suggestions use a viewport-bound portal", async ({ page }) => {
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
      expect(new URL(route.request().url()).searchParams.get("sessionId")).toBe(
        "layout-session",
      );
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
    const input = page.locator(".paper-search-control input");
    await expect(input).toBeEnabled();
    await input.fill("layout");

    const suggestionList = page.locator(".suggestion-list");
    await expect(suggestionList).toBeVisible();
    await expect(suggestionList.locator(".suggestion")).toHaveCount(12);

    await expect(async () => {
      const layout = await page.evaluate(() => {
        const surface = document.querySelector("main");
        const input = document.querySelector(".paper-search-control");
        const list = document.querySelector(".suggestion-list-positioner");
        if (!surface || !input || !list) return null;

        const inputRect = input.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        return {
          bodyParent: list.parentElement === document.body,
          inputLeft: inputRect.left,
          inputWidth: inputRect.width,
          listLeft: listRect.left,
          listWidth: listRect.width,
          listTop: listRect.top,
          listBottom: listRect.bottom,
          overflow: window.getComputedStyle(surface).overflow,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
        };
      });

      expect(layout).not.toBeNull();
      expect(layout?.bodyParent).toBe(true);
      expect(layout?.overflow).toBe("hidden");
      const expectedWidth = Math.min(
        640,
        layout?.inputWidth ?? 0,
        (layout?.viewportWidth ?? 0) - 24,
      );
      const expectedLeft = Math.min(
        Math.max(12, layout?.inputLeft ?? 0),
        (layout?.viewportWidth ?? 0) - expectedWidth - 12,
      );
      expect(
        Math.abs(expectedLeft - (layout?.listLeft ?? 0)),
      ).toBeLessThanOrEqual(2);
      expect(
        Math.abs(expectedWidth - (layout?.listWidth ?? 0)),
      ).toBeLessThanOrEqual(2);
      expect(layout?.listTop).toBeGreaterThanOrEqual(0);
      expect(layout?.listBottom).toBeLessThanOrEqual(
        layout?.viewportHeight ?? 0,
      );
      expect(
        (layout?.listLeft ?? -1) + (layout?.listWidth ?? 0),
      ).toBeLessThanOrEqual(layout?.viewportWidth ?? 0);
    }).toPass();
  });

  test("keyboard selects a suggestion and Escape closes the list", async ({
    page,
  }) => {
    const session = {
      id: "keyboard-session",
      mode: "random",
      contentType: "character",
      status: "playing",
      maxGuesses: 8,
      guesses: [],
      startedAt: "2026-08-06T00:00:00.000Z",
    };
    await page.route("**/api/puzzles/random", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ puzzleLabel: "随机题", session }),
      }),
    );
    await page.route("**/api/characters/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              id: "reimu_hakurei",
              name: "博丽灵梦",
              subtitle: "Reimu Hakurei · 东方红魔乡",
              initials: "博丽",
              avatarUrl: "",
              appearanceOrder: 1,
              firstAppearance: { workTitle: "东方红魔乡", releaseYear: 2002 },
              species: ["human"],
              locations: ["hakurei_shrine"],
              affiliations: ["hakurei_shrine"],
              hairColors: ["brown"],
            },
          ],
          total: 1,
        }),
      }),
    );

    await page.goto("/single/random");
    const input = page.getByLabel("搜索东方角色");
    await input.fill("灵梦");
    await expect(page.locator(".suggestion")).toBeVisible();
    await input.press("ArrowDown");
    await expect(input).toHaveAttribute(
      "aria-activedescendant",
      /reimu_hakurei/,
    );
    await input.press("Enter");
    await expect(input).toHaveValue("博丽灵梦");
    await expect(page.getByRole("button", { name: "提交猜测" })).toBeEnabled();

    await input.fill("灵梦");
    await expect(input).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".suggestion-list")).toBeVisible();
    await input.press("Escape");
    await expect(page.locator(".suggestion-list")).toBeHidden();
  });
});
