import { expect, test } from "@playwright/test";
import { CHARACTER_GUESS_FIELDS } from "@touhouflandre/shared";
import { buildSingleGameSeed } from "../src/dev/gameSeeds";

for (const mode of ["daily", "random"] as const) {
  for (const preset of ["empty", "playing", "won", "lost"] as const) {
    test(`${mode} ${preset} uses the shared record table`, async ({
      page,
    }, testInfo) => {
      const seed = buildSingleGameSeed(preset, mode);
      const session = seed.session!;
      session.activeFields = [...CHARACTER_GUESS_FIELDS];
      await page.addInitScript(
        ({ mode, seed }) => {
          localStorage.setItem(
            `touhouflandre:${mode}-session`,
            JSON.stringify({
              id: seed.session!.id,
              puzzleKey: seed.session!.puzzleKey,
              activeElapsedMs: seed.initialElapsedMs,
              guessCompletedElapsedMs: seed.guessCompletedElapsedMs,
              savedAtMs: Date.now(),
            }),
          );
        },
        { mode, seed },
      );
      await page.route(`**/api/puzzles/${mode}/resolve`, (route) =>
        route.fulfill({
          json: {
            session,
            puzzleLabel: seed.puzzleLabel,
            resolution: "resumed",
          },
        }),
      );
      await page.goto(`/single/${mode}`);
      await page.addStyleTag({
        content:
          "nextjs-portal, [data-agentation-root], [data-agentation-toolbar] { display: none !important; }",
      });
      const region = page.getByRole("region", { name: "猜测记录" });
      const table = region.locator("table");
      await expect(table).toBeVisible();
      await expect(table.getByRole("columnheader")).toHaveCount(8);
      await expect(
        table.getByRole("columnheader", { name: "本次猜测用时" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const regionBox = (await region.boundingBox())!;
      expect(regionBox.x + regionBox.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
      if (preset === "empty") {
        await expect(table.getByText("等待第一次猜测")).toBeVisible();
      } else {
        await expect(table.getByText("博丽灵梦")).toBeVisible();
        await expect(table.getByText("00:04", { exact: true })).toBeVisible();
        const cell = table.locator(".feedback-cell-exact").first();
        const paint = await cell.evaluate((element) => ({
          cell: getComputedStyle(element).backgroundColor,
          feedback: getComputedStyle(element.querySelector(".feedback")!)
            .backgroundColor,
        }));
        expect(paint.cell).not.toBe("rgba(0, 0, 0, 0)");
        expect(paint.feedback).toBe("rgba(0, 0, 0, 0)");
        if (page.viewportSize()!.width <= 680) {
          await region.evaluate((element) => {
            element.scrollLeft = element.scrollWidth;
          });
          const character = table.locator('tbody th[scope="row"]').first();
          expect((await character.boundingBox())!.x).toBeGreaterThanOrEqual(
            regionBox.x,
          );
          await expect(character).toHaveCSS(
            "background-color",
            "rgb(255, 255, 255)",
          );
          await region.evaluate((element) => {
            element.scrollLeft = 0;
          });
        }
      }
      if (preset === "won" || preset === "lost") {
        await expect(page.getByLabel("游戏结果")).toBeVisible();
      }
      if (preset === "won") {
        const result = page.getByLabel("游戏结果");
        expect(await result.evaluate((element) => element.tagName)).toBe(
          "ASIDE",
        );
        await expect(result).toHaveAttribute("data-paper-variant", "plain");
        await expect(
          result.getByRole("button", { name: "复制分享" }),
        ).toHaveCSS("border-radius", "0px");
        const card = (await result.boundingBox())!;
        const avatar = (await result.locator(".answer-token").boundingBox())!;
        const details = (await result
          .getByLabel("答案角色资料")
          .boundingBox())!;
        const actions = (await result
          .getByRole("button", { name: "复制分享" })
          .locator("..")
          .boundingBox())!;
        expect(avatar.width).toBe(70);
        expect(avatar.height).toBe(70);
        expect(avatar.x + avatar.width).toBeLessThan(card.x + card.width);
        expect(avatar.y - card.y).toBeLessThan(30);
        expect(details.width).toBeGreaterThan(card.width - 60);
        expect(actions.y).toBeGreaterThanOrEqual(details.y + details.height);
        expect(actions.x - card.x).toBeLessThan(30);
        await result.screenshot({
          path: testInfo.outputPath(`${mode}-result.png`),
          animations: "disabled",
        });
      }
      await region.scrollIntoViewIfNeeded();
      await region.screenshot({
        path: testInfo.outputPath(`${mode}-${preset}.png`),
        animations: "disabled",
      });
    });
  }
}
