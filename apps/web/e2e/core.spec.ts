import { test, expect } from "@playwright/test";

test.describe("站点骨架", () => {
  test("首页展示目录摘要与导航", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "东方芙一把" }),
    ).toBeVisible();
    const catalogStats = page.locator('[aria-label="今日题信息"] strong');
    await expect(catalogStats).toHaveCount(3);
    await expect(catalogStats.last()).not.toHaveText("-");
    await expect(
      page.getByRole("navigation", { name: "站点导航" }),
    ).toBeVisible();
    for (const label of ["每日题", "随机题", "其他模式", "题库索引"]) {
      await expect(
        page.getByRole("link", { name: new RegExp(label) }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: "背景图 Pixiv 作品 56866592" }),
    ).toHaveAttribute("href", "https://www.pixiv.net/artworks/56866592");
    await expect(
      page.getByRole("link", { name: "背景图画师 Pixiv 用户 2179695" }),
    ).toHaveAttribute("href", "https://www.pixiv.net/users/2179695");
  });

  test("友链页展示当前首页背景图署名", async ({ page }) => {
    await page.goto("/links");
    await expect(
      page.getByText("羽々斬 - Pixiv 作品 56866592", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('a[href="https://www.pixiv.net/artworks/56866592"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('a[href="https://www.pixiv.net/users/2179695"]'),
    ).toHaveCount(1);
  });

  test("未知路径渲染 404 页", async ({ page }) => {
    await page.goto("/nonexistent-route");
    await expect(
      page.getByRole("heading", { name: "页面不存在" }),
    ).toBeVisible();
  });

  test("导航高亮随路由切换", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".nav-link.active")).toContainText("首页");
    const mobileToggle = page.getByRole("button", {
      name: "展开站点导航",
    });
    if (await mobileToggle.isVisible()) await mobileToggle.click();
    await page.getByRole("link", { name: "搜索" }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator(".nav-link.active")).toContainText("搜索");
  });

  test("移动端导航在页眉内展开并在跳转后收起", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/single");

    const navigation = page.getByRole("navigation", { name: "站点导航" });
    const toggle = page.getByRole("button", { name: "展开站点导航" });
    const links = navigation.locator(".nav-links");
    await expect(toggle).toBeVisible();
    await expect(links).toHaveCSS("visibility", "hidden");

    await page.getByRole("button", { name: "打开主题颜色" }).click();
    await expect(navigation).toHaveAttribute(
      "data-mobile-presentation",
      "palette",
    );
    await expect(links).toHaveCSS("visibility", "hidden");
    await expect(page.locator(".appearance-swatch")).toHaveCount(6);
    await expect(page.locator(".appearance-swatch:visible")).toHaveCount(6);
    await expect(
      page.locator('.appearance-swatch[data-selected="true"] .lucide-check'),
    ).toBeVisible();
    await page.getByRole("button", { name: "关闭主题颜色" }).click();
    await expect(navigation).toHaveAttribute(
      "data-mobile-presentation",
      "none",
    );

    await toggle.click();
    await expect(
      page.getByRole("button", { name: "关闭站点导航" }),
    ).toHaveAttribute("aria-expanded", "true");
    await expect(links).toHaveCSS("visibility", "visible");
    const navigationBox = await navigation.boundingBox();
    const linksBox = await links.boundingBox();
    expect(navigationBox).not.toBeNull();
    expect(linksBox).not.toBeNull();
    expect(navigationBox!.y).toBeLessThanOrEqual(1);
    expect(linksBox!.y).toBeGreaterThanOrEqual(navigationBox!.y);
    expect(linksBox!.y + linksBox!.height).toBeLessThanOrEqual(
      navigationBox!.y + navigationBox!.height + 1,
    );
    await page.getByRole("link", { name: "统计" }).click();

    await expect(page).toHaveURL(/\/stats/);
    await expect(
      page.getByRole("button", { name: "展开站点导航" }),
    ).toHaveAttribute("aria-expanded", "false");
    await expect(links).toHaveCSS("visibility", "hidden");
  });
});

test.describe("搜索", () => {
  test("关键词与罗马字搜索命中", async ({ page }) => {
    await page.goto("/search");
    const input = page.getByLabel("搜索角色");
    await input.fill("reimu");
    await expect(page.locator("article strong")).toHaveText(["博丽灵梦"]);
    await input.fill("");
    await input.pressSequentially("红白");
    await expect(page.locator("article strong")).toHaveText(["博丽灵梦"]);
  });

  test("列表视图切换同步 URL", async ({ page }) => {
    await page.goto("/search");
    await page.getByRole("button", { name: "列表视图" }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect
      .poll(() => page.locator("table tbody tr").count())
      .toBeGreaterThan(0);
  });
});

test.describe("每日题游戏流程", () => {
  test("创建、猜测、反馈、恢复、重建", async ({ page }) => {
    await page.goto("/single/daily");

    // 创建：题目为今日日期，进度 0/8（等待输入可用，避免 loading 吞输入）
    await expect(page.locator(".status-strip")).toContainText(/进度\s*0\/8/);
    await expect(page.getByLabel("搜索东方角色")).toBeEnabled();
    await expect(page.locator(".status-strip")).toContainText("进行中");
    await expect(page.getByLabel("重新开始随机题")).toHaveCount(0);

    // 猜测灵梦
    const input = page.getByLabel("搜索东方角色");
    await input.pressSequentially("灵梦");
    await page.locator(".suggestion", { hasText: "博丽灵梦" }).click();
    await page.getByRole("button", { name: "提交猜测" }).click();
    await expect(page.locator(".status-strip")).toContainText(/进度\s*1\/8/);
    await expect(page.locator(".guess-table tbody tr")).toHaveCount(1);

    // 刷新恢复会话
    await page.reload();
    await expect(page.locator(".status-strip")).toContainText(/进度\s*1\/8/);

    // 伪造旧会话 id → 404 → 自动重建
    await page.evaluate(() => {
      localStorage.setItem(
        "touhouflandre:daily-session",
        JSON.stringify({
          id: "stale-session-from-vite",
          puzzleKey: "2026-08-05",
        }),
      );
    });
    await page.reload();
    await expect(page.locator(".status-strip")).toContainText(/进度\s*0\/8/);
  });

  test("模式入口创建随机题新局", async ({ page }) => {
    await page.goto("/single");
    await page.getByRole("link", { name: /随机题/ }).click();
    await expect(page).toHaveURL(/\/single\/random/);
    await expect(page.locator(".status-strip")).toContainText(/进度\s*0\/8/);
    await expect(page.locator(".status-strip")).toContainText("随机题");
  });

  test("非法模式返回 404", async ({ page }) => {
    await page.goto("/single/foo");
    await expect(
      page.getByRole("heading", { name: "页面不存在" }),
    ).toBeVisible();
  });
});
