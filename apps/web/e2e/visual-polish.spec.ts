import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial", timeout: 90_000 });

const searchResult = {
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
};

test.describe("visual polish", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/catalog", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          dailyDateKey: "2026-08-06",
          contents: [
            {
              contentType: "character",
              label: "角色",
              total: 29,
              guessable: 29,
              answerable: 29,
              maxGuesses: 8,
              visibleFieldCount: 6,
            },
          ],
        }),
      }),
    );
    await page.route("**/api/characters/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ results: [searchResult], total: 1 }),
      }),
    );
  });

  test("home uses the completed animation and bold title", async ({ page }) => {
    await page.goto("/");
    const title = page.getByRole("heading", { name: "东方芙一把" });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("font-weight", /700|800|900/);
    await expect(page.locator("main")).toHaveScreenshot("home-main.png", {
      animations: "disabled",
    });
  });

  test("search focus and segmented controls have stable states", async ({
    page,
  }) => {
    await page.goto("/search");
    const input = page.getByLabel("搜索角色");
    await input.focus();
    await expect(input).toHaveCSS("outline-style", "none");
    await expect(input).toHaveCSS("box-shadow", "none");
    await expect(
      page.getByRole("button", { name: "图标视图" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("main")).toHaveScreenshot("search-main.png", {
      animations: "disabled",
    });
  });

  test("appearance switcher toggles mode and persists color", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.localStorage.clear();
    });
    await page.goto("/");

    const root = page.locator("html");
    const toggle = page.locator(".appearance-toggle");
    const palette = page.locator(".appearance-palette");
    const swatches = page.locator(".appearance-swatch");

    await expect(root).toHaveAttribute("data-theme-color", "scarlet");
    await toggle.hover();
    await expect(palette).toBeVisible();
    await expect(swatches.first()).toHaveCSS(
      "background-color",
      "rgb(173, 51, 52)",
    );

    await toggle.click();
    await expect(root).toHaveAttribute("data-theme-mode", "dark");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(15, 20, 19)",
    );

    await swatches.nth(1).click();
    await expect(root).toHaveAttribute("data-theme-color", "sakura");
    await expect
      .poll(() =>
        page.evaluate(() =>
          JSON.parse(
            window.localStorage.getItem("touhoufriberg:appearance") ?? "{}",
          ),
        ),
      )
      .toEqual({ color: "sakura", mode: "dark" });

    await page.reload();
    await expect(root).toHaveAttribute("data-theme-mode", "dark");
    await expect(root).toHaveAttribute("data-theme-color", "sakura");
  });

  test("daily result uses yin-yang marks and a neutral answer avatar", async ({
    page,
  }) => {
    const session = {
      id: "visual-daily-session",
      mode: "daily",
      contentType: "character",
      status: "won",
      maxGuesses: 8,
      puzzleKey: "2026-08-06",
      guesses: [
        {
          guessId: "reimu_hakurei",
          guessName: "博丽灵梦",
          isCorrect: true,
          feedback: [],
        },
      ],
      answer: {
        id: "reimu_hakurei",
        avatarUrl: "",
        names: {
          zhHans: "博丽灵梦",
          ja: "博麗霊夢",
          en: "Reimu Hakurei",
          aliases: [],
        },
        firstAppearance: {
          workId: "th06",
          workTitle: "东方红魔乡",
          workType: "mainline",
          releaseYear: 2002,
        },
        species: ["human"],
        abilityDisplay: "飞行程度的能力",
        abilityTags: [],
        affiliations: [],
        locations: [],
        roles: [],
        hairColors: ["brown"],
        playable: true,
        enabledAsAnswer: true,
        enabledAsGuess: true,
        difficultyTier: "easy",
        sourceRefs: [],
        appearanceOrder: 1,
      },
      startedAt: "2026-08-06T00:00:00.000Z",
      endedAt: "2026-08-06T00:01:00.000Z",
    };
    await page.route("**/api/puzzles/daily", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ puzzleLabel: "每日题 2026-08-06", session }),
      }),
    );

    await page.goto("/single/daily");
    await expect(page.locator(".game-emblem svg")).toBeVisible();
    await expect(page.getByText("复制分享")).toHaveCount(0);
    await expect(page.getByText("再来一局")).toHaveCount(0);
    await expect(page.locator(".answer-token")).not.toHaveCSS(
      "background-color",
      "rgb(183, 71, 63)",
    );
    await expect(page.locator("main")).toHaveScreenshot(
      "daily-result-main.png",
      {
        animations: "disabled",
      },
    );
  });
});
