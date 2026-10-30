import { expect, test, type Page } from "@playwright/test";

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

async function prepareVisualPage(page: Page) {
  await page.addStyleTag({
    content:
      "[data-agentation-toolbar], [data-agentation-root], nextjs-portal { display: none !important; }",
  });
}

async function seedMultiplayer(page: Page, preset: string) {
  await page.goto("/multi");
  await page.waitForFunction(() =>
    Boolean(
      (
        window as typeof window & {
          __touhouflandreDev?: { game?: { seed: (name: string) => string } };
        }
      ).__touhouflandreDev?.game,
    ),
  );
  await page.evaluate((name) => {
    const game = (
      window as typeof window & {
        __touhouflandreDev?: { game?: { seed: (seed: string) => string } };
      }
    ).__touhouflandreDev?.game;
    if (!game) throw new Error("Multiplayer development seeds unavailable");
    game.seed(name);
  }, preset);
  await page.waitForURL(/\/multi\/room\/DEV222$/);
  await expect(page.locator(".multiplayer-match-page")).toBeVisible();
}

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

  test("wide-screen navigation stays anchored across page layouts", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    const measurements: Array<{
      mainLeft: number;
      mainWidth: number;
      navLeft: number;
      navLinksLeft: number;
      navWidth: number;
    }> = [];

    for (const route of ["/", "/single", "/search", "/stats", "/links"]) {
      await page.goto(route);
      await expect(page.locator(".site-nav-inner")).toBeVisible();
      measurements.push(
        await page.evaluate(() => {
          const main = document
            .querySelector(".site-main")!
            .getBoundingClientRect();
          const nav = document
            .querySelector(".site-nav-inner")!
            .getBoundingClientRect();
          const navLinks = document
            .querySelector(".nav-links")!
            .getBoundingClientRect();
          return {
            mainLeft: main.left,
            mainWidth: main.width,
            navLeft: nav.left,
            navLinksLeft: navLinks.left,
            navWidth: nav.width,
          };
        }),
      );
    }

    for (const key of [
      "mainLeft",
      "mainWidth",
      "navLeft",
      "navLinksLeft",
      "navWidth",
    ] as const) {
      const values = measurements.map((measurement) => measurement[key]);
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    }
    expect(measurements[0].mainWidth).toBe(measurements[0].navWidth);
  });

  test("home keeps its hero and feature cards across breakpoints", async ({
    page,
  }) => {
    await page.goto("/");
    await prepareVisualPage(page);
    const title = page.getByRole("heading", { name: "东方芙一把" });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS("font-weight", /700|800|900/);
    await expect(page.locator("main")).toHaveScreenshot("home-main.png", {
      animations: "disabled",
    });

    await page.setViewportSize({ width: 800, height: 900 });
    await expect(page.locator(".home-hero-shortcuts")).toBeVisible();
    const geometry = await page.evaluate(() => {
      const hero = document
        .querySelector(".home-hero")!
        .getBoundingClientRect();
      const footer = document
        .querySelector(".site-footer")!
        .getBoundingClientRect();
      const cards = [...document.querySelectorAll(".paper-shortcut")];
      const cardBottom = Math.max(
        ...cards.map((card) => card.getBoundingClientRect().bottom),
      );
      return {
        cardCount: cards.length,
        cardPatterns: cards.map(
          (card) => (card as HTMLElement).dataset.paperPattern,
        ),
        otherPatterns: [
          ...document.querySelectorAll(".paper-surface:not(.paper-shortcut)"),
        ].map((paper) => (paper as HTMLElement).dataset.paperPattern),
        footerGap: footer.top - cardBottom,
        heroBottom: hero.bottom,
        heroLeft: hero.left,
        heroRight: hero.right,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.cardCount).toBe(4);
    expect(geometry.cardPatterns).toEqual(Array(4).fill("default"));
    expect(geometry.otherPatterns.every((pattern) => pattern === "none")).toBe(
      true,
    );
    expect(geometry.heroLeft).toBeLessThanOrEqual(1);
    expect(geometry.heroRight).toBeGreaterThanOrEqual(
      geometry.viewportWidth - 1,
    );
    expect(geometry.heroBottom).toBeGreaterThanOrEqual(geometry.viewportHeight);
    expect(geometry.footerGap).toBeGreaterThanOrEqual(36);
  });

  test("game-mode feature cards keep a safe footer gap", async ({ page }) => {
    await page.setViewportSize({ width: 680, height: 800 });
    await page.goto("/single");
    await prepareVisualPage(page);
    const geometry = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".game-mode-entry")];
      const footerTop = document
        .querySelector(".site-footer")!
        .getBoundingClientRect().top;
      const cardBottom = Math.max(
        ...cards.map((card) => card.getBoundingClientRect().bottom),
      );
      return {
        footerGap: footerTop - cardBottom,
        patterns: cards.map(
          (card) => (card as HTMLElement).dataset.paperPattern,
        ),
        otherPatterns: [
          ...document.querySelectorAll(".paper-surface:not(.game-mode-entry)"),
        ].map((paper) => (paper as HTMLElement).dataset.paperPattern),
      };
    });
    expect(geometry.footerGap).toBeGreaterThanOrEqual(36);
    expect(geometry.patterns).toEqual(Array(4).fill("default"));
    expect(geometry.otherPatterns.every((pattern) => pattern === "none")).toBe(
      true,
    );
  });

  test("search focus and segmented controls have stable states", async ({
    page,
  }) => {
    await page.goto("/search");
    await prepareVisualPage(page);
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
    await page.goto("/");
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();
    await prepareVisualPage(page);

    const root = page.locator("html");
    const toggle = page.locator(".appearance-toggle");
    const palette = page.locator(".appearance-palette");
    const swatches = page.locator(".appearance-swatch");
    const readThemeColor = () =>
      page.evaluate(() => {
        const probe = document.createElement("span");
        probe.style.color = "var(--theme-color)";
        document.body.append(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        return color;
      });

    await expect(root).toHaveAttribute("data-theme-color", "scarlet");
    expect(await readThemeColor()).toBe("rgb(173, 51, 52)");
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();
    const mobileAppearance = (page.viewportSize()?.width ?? 0) <= 680;
    const cornerSurface = page.locator(".appearance-corner-surface");
    if (mobileAppearance) {
      await expect(cornerSurface).toBeHidden();
    } else {
      await expect(cornerSurface).toBeVisible();
      await expect(cornerSurface).toHaveCSS("clip-path", /polygon/);
      await expect(cornerSurface).toHaveAttribute("data-paper-shape", "corner");
    }
    if (mobileAppearance) {
      await toggle.click();
    } else {
      await toggle.hover();
    }
    await expect(palette).toBeVisible();
    if (mobileAppearance) {
      const paletteBox = await palette.boundingBox();
      expect(paletteBox?.y).toBeLessThanOrEqual(1);
      expect(paletteBox?.height).toBeGreaterThan(40);
    }
    await expect(swatches.first()).toHaveCSS(
      "background-color",
      "rgb(173, 51, 52)",
    );

    await toggle.click();
    await expect(root).toHaveAttribute("data-theme-mode", "dark");
    await expect(root).toHaveCSS("color-scheme", "dark");
    expect(await readThemeColor()).toBe("rgb(224, 112, 108)");

    const sakuraSwatch = page.locator(
      '.appearance-swatch[data-theme-color="sakura"]',
    );
    await expect(sakuraSwatch).toBeVisible();
    await expect(sakuraSwatch).toBeEnabled();
    if ((page.viewportSize()?.width ?? 0) <= 680) {
      await sakuraSwatch.click();
    } else {
      await sakuraSwatch.click({ position: { x: 535, y: 210 } });
    }
    await expect(root).toHaveAttribute("data-theme-color", "sakura");
    expect(await readThemeColor()).toBe("rgb(228, 127, 169)");
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
    expect(await readThemeColor()).toBe("rgb(228, 127, 169)");

    const themeVariants = [
      ["scarlet", "rgb(173, 51, 52)", "rgb(224, 112, 108)"],
      ["sakura", "rgb(185, 80, 127)", "rgb(228, 127, 169)"],
      ["iris", "rgb(111, 99, 182)", "rgb(163, 152, 227)"],
      ["jade", "rgb(36, 117, 104)", "rgb(89, 185, 167)"],
      ["amber", "rgb(163, 103, 20)", "rgb(214, 154, 67)"],
      ["azure", "rgb(52, 120, 180)", "rgb(108, 166, 217)"],
    ] as const;
    for (const [color, light, dark] of themeVariants) {
      await root.evaluate((element, value) => {
        (element as HTMLElement).dataset.themeColor = value;
        (element as HTMLElement).dataset.themeMode = "light";
      }, color);
      expect(await readThemeColor()).toBe(light);
      await root.evaluate((element) => {
        (element as HTMLElement).dataset.themeMode = "dark";
      });
      expect(await readThemeColor()).toBe(dark);
    }
  });

  test("daily result shows a neutral answer avatar and Paper actions", async ({
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
    await prepareVisualPage(page);
    await expect(page.locator(".answer-token")).toBeVisible();
    await expect(page.getByText("复制分享")).toBeVisible();
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

  test("multiplayer boards and command deck match the shared game layout", async ({
    page,
  }) => {
    await page.clock.install({ time: new Date("2026-08-14T12:00:00Z") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await seedMultiplayer(page, "race-n-player");
    await prepareVisualPage(page);
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );

    const largeGeometry = await page.evaluate(() => {
      const deck = document
        .querySelector(".multiplayer-command-deck")!
        .getBoundingClientRect();
      const footer = document
        .querySelector(".site-footer")!
        .getBoundingClientRect();
      const boards = [
        ...document.querySelectorAll(
          ".multiplayer-race-board-pair .multiplayer-board-paper",
        ),
      ].map((board) => board.getBoundingClientRect());
      const timer = document
        .querySelector('[role="timer"]')!
        .getBoundingClientRect();
      const mode = document
        .querySelector(".multiplayer-match-mode")!
        .getBoundingClientRect();
      return {
        deckBottom: deck.bottom,
        footerTop: footer.top,
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        boardTopDelta: Math.abs(boards[0].top - boards[1].top),
        timerHeight: timer.height,
        modeHeight: mode.height,
        boardWidths: boards.map((board) => board.width),
        rowHeights: [
          ...document.querySelectorAll(
            ".multiplayer-race-board-pair .multiplayer-guess-table tbody tr",
          ),
        ].map((row) => row.getBoundingClientRect().height),
      };
    });
    expect(largeGeometry.overflow).toBe(false);
    expect(
      Math.abs(largeGeometry.deckBottom - largeGeometry.footerTop),
    ).toBeLessThanOrEqual(1);
    expect(largeGeometry.boardTopDelta).toBeLessThanOrEqual(3);
    expect(largeGeometry.boardWidths[0]).toBeGreaterThan(
      largeGeometry.boardWidths[1] * 2,
    );
    expect(Math.min(...largeGeometry.rowHeights)).toBeLessThanOrEqual(58);
    expect(Math.max(...largeGeometry.rowHeights)).toBeLessThanOrEqual(82);
    expect(largeGeometry.timerHeight).toBeGreaterThan(largeGeometry.modeHeight);
    await expect(page.getByRole("list", { name: "当前积分" })).toBeVisible();
    await expect(page.locator(".paper-pagination-counter")).toContainText(
      "P2 雾之湖对手 · 1 / 3",
    );
    await expect(page.getByText("聊天", { exact: true })).toBeVisible();
    await expect(page.getByText("猜测", { exact: true })).toBeVisible();
    await page.getByLabel("聊天输入").fill("测试消息");
    await expect(page.getByLabel("发送消息")).toHaveAttribute(
      "data-paper-tone",
      "neutral",
    );
    await expect(page.getByLabel("发送消息")).toHaveAttribute(
      "data-paper-variant",
      "tinted",
    );
    await expect(page.getByLabel("发送消息")).toHaveAttribute(
      "data-paper-folded",
      "true",
    );
    await expect(page.getByLabel("发送消息")).toHaveAttribute(
      "data-paper-shape",
      "note",
    );

    await page.route("**/api/characters/search?**", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          results: [
            {
              ...searchResult,
              id: "sakuya_izayoi",
              name: "十六夜咲夜",
              subtitle: "Sakuya Izayoi · 东方红魔乡",
              initials: "十六",
            },
          ],
          total: 1,
        }),
      }),
    );
    await page.getByLabel("搜索角色").fill("咲夜");
    await page.getByRole("option", { name: /十六夜咲夜/ }).click();
    const submitGuess = page.getByRole("button", { name: "提交猜测" });
    await expect(submitGuess).toHaveAttribute("data-paper-variant", "tinted");
    await expect(submitGuess).toHaveAttribute("data-paper-folded", "true");
    await expect(submitGuess).toHaveAttribute("data-paper-shape", "note");

    const selfCell = page
      .locator('.multiplayer-board[data-board-variant="self"] .feedback-cell')
      .first();
    const opponentCell = page
      .locator(".multiplayer-icon-feedback-cell")
      .first();
    await expect(selfCell).toHaveClass(/paper-tinted-cell/);
    await expect(selfCell.locator(".feedback")).toHaveClass(
      /feedback-(exact|partial|miss|higher|lower|unknown)/,
    );
    await expect(opponentCell).toHaveClass(/paper-tinted-cell/);
    const iconAlignment = await opponentCell.evaluate((cell) => {
      const icon = cell.querySelector("b")!.getBoundingClientRect();
      const bounds = cell.getBoundingClientRect();
      return {
        horizontal: Math.abs(
          icon.left + icon.width / 2 - (bounds.left + bounds.width / 2),
        ),
        vertical: Math.abs(
          icon.top + icon.height / 2 - (bounds.top + bounds.height / 2),
        ),
        background: getComputedStyle(cell).backgroundColor,
      };
    });
    expect(iconAlignment.horizontal).toBeLessThanOrEqual(2);
    expect(iconAlignment.vertical).toBeLessThanOrEqual(1);
    expect(iconAlignment.background).not.toBe("rgba(0, 0, 0, 0)");

    const toggle = page.getByRole("button", { name: "展开对局信息" });
    await expect(toggle).toBeHidden();
    await page.setViewportSize({ width: 440, height: 956 });
    await expect(toggle).toBeVisible();
    const details = page.locator(".multiplayer-match-summary-details");
    await expect(details).toBeHidden();
    await toggle.click();
    await expect(details).toBeVisible();
    await expect(
      page.getByRole("button", { name: "收起对局信息" }),
    ).toHaveAttribute("aria-expanded", "true");

    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight),
    );
    const mobileGeometry = await page.evaluate(() => {
      const deck = document
        .querySelector(".multiplayer-command-deck")!
        .getBoundingClientRect();
      const footer = document
        .querySelector(".site-footer")!
        .getBoundingClientRect();
      const lastBoard = [...document.querySelectorAll(".multiplayer-board")]
        .at(-1)!
        .getBoundingClientRect();
      const scores = [
        ...document.querySelectorAll(".member-score-strip > li"),
      ].map((item) => item.getBoundingClientRect());
      const scoreRow = document
        .querySelector(".multiplayer-match-score-row")!
        .getBoundingClientRect();
      return {
        deckBottom: deck.bottom,
        deckTop: deck.top,
        footerTop: footer.top,
        lastBoardBottom: lastBoard.bottom,
        scoresVisible: scores.every(
          (score) =>
            score.left >= scoreRow.left - 1 &&
            score.right <= scoreRow.right + 1,
        ),
      };
    });
    expect(
      Math.abs(mobileGeometry.deckBottom - mobileGeometry.footerTop),
    ).toBeLessThanOrEqual(1);
    expect(mobileGeometry.lastBoardBottom).toBeLessThanOrEqual(
      mobileGeometry.deckTop,
    );
    expect(mobileGeometry.scoresVisible).toBe(true);

    await page.getByLabel("搜索角色").fill("灵梦");
    await page.evaluate(() => {
      const game = (
        window as typeof window & {
          __touhouflandreDev?: { game?: { seed: (seed: string) => string } };
        }
      ).__touhouflandreDev?.game;
      game?.seed("viewer-disconnected");
    });
    await expect(page.getByLabel("搜索角色")).toBeDisabled();
    await expect(page.getByLabel("搜索角色")).toHaveValue("灵梦");
    await expect(
      page.getByText("实时同步恢复后可继续猜测").last(),
    ).toBeVisible();
    await expect(page.getByLabel("展开聊天记录")).toBeEnabled();
  });

  test("relay feedback stays compact and semantically tinted", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 900 });
    await seedMultiplayer(page, "relay-playing");
    await prepareVisualPage(page);

    const geometry = await page.evaluate(() => {
      const summary = document
        .querySelector(".relay-match-summary")!
        .getBoundingClientRect();
      const cells = [...document.querySelectorAll(".relay-turn-feedback-cell")];
      const firstRow = cells.slice(0, 6).map((cell) => {
        const rect = cell.getBoundingClientRect();
        return {
          background: getComputedStyle(cell).backgroundColor,
          bottom: rect.bottom,
          top: rect.top,
        };
      });
      const probe = document.createElement("span");
      probe.style.backgroundColor = "var(--theme-color)";
      document.body.append(probe);
      const themeColor = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        cellCount: firstRow.length,
        distinctBackgrounds: new Set(firstRow.map((cell) => cell.background))
          .size,
        maxBottomDelta: Math.max(
          ...firstRow.map((cell) => Math.abs(cell.bottom - firstRow[0].bottom)),
        ),
        maxTopDelta: Math.max(
          ...firstRow.map((cell) => Math.abs(cell.top - firstRow[0].top)),
        ),
        outerOverflow: document.documentElement.scrollWidth > window.innerWidth,
        summaryHeight: summary.height,
        themeColor,
        usesRawThemeFill: firstRow.some(
          (cell) => cell.background === themeColor,
        ),
      };
    });

    expect(geometry.summaryHeight).toBeLessThan(200);
    expect(geometry.cellCount).toBe(6);
    expect(geometry.distinctBackgrounds).toBeGreaterThan(1);
    expect(geometry.maxTopDelta).toBeLessThanOrEqual(1);
    expect(geometry.maxBottomDelta).toBeLessThanOrEqual(1);
    expect(geometry.usesRawThemeFill).toBe(false);
    expect(geometry.outerOverflow).toBe(false);
  });
});
