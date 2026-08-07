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
    await page.locator(".nav-link", { hasText: "搜索" }).click();
    await expect(page).toHaveURL(/\/search/);
    await expect(page.locator(".nav-link.active")).toContainText("搜索");
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

  test("模式切换创建随机题新局", async ({ page }) => {
    await page.goto("/single/daily");
    await expect(page.locator(".status-strip")).toContainText("进行中");
    await page.locator(".mode-tab", { hasText: "随机题" }).click();
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
