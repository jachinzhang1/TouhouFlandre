import { expect, test, type Page } from "@playwright/test";
import type {
  RelayEncounterView,
  RelayMatchFragment,
} from "@touhouflandre/shared";
import {
  buildMultiplayerGameSeed,
  type MultiplayerGameSeedPreset,
} from "../src/dev/gameSeeds";

// Exercise the real room page and dock with stable server projections. These
// checks deliberately assert geometry rather than copying component classes.
async function openMatch(page: Page, preset: MultiplayerGameSeedPreset) {
  const { state } = buildMultiplayerGameSeed(preset);
  if (preset === "race-match-result") {
    // Include the final round replay, as a real finished-room snapshot does.
    state.roundResult = {
      ...buildMultiplayerGameSeed("race-round-result").state.roundResult!,
      roundIndex: state.match!.roundIndex,
      scores: state.match!.scores,
      nextStartsAt: undefined,
    };
  }
  const room = state.room!;
  let relay: RelayMatchFragment | undefined;
  if (room.mode === "relay") {
    const encounter: RelayEncounterView = {
      encounterId: "layout-encounter",
      encounterIndex: 1,
      status: "playing",
      members: state.members.map((member, index) => ({
        memberId: member.memberId,
        seat: member.seat,
        side: (index + 1) as 1 | 2,
      })),
      turnMemberId: state.round!.turnMemberId,
      turnDeadline: state.round!.turnDeadline,
      deadline: state.round!.deadline,
      maxTurnsPerPlayer: 8,
      maxSkipsPerPlayer: 2,
      rows: state.round!.shared!.rows,
      capabilities: { canGuess: true, canPass: true, canForfeit: true },
    };
    relay = {
      ruleSetRef: { mode: "relay", key: "legacy_wins", version: 1 },
      standings: state.members.map((member) => ({
        memberId: member.memberId,
        seat: member.seat,
        score: 0,
        status: "active",
        lifeState: "healthy",
      })),
      currentStage: {
        stageId: "layout-stage",
        stageIndex: 1,
        status: "playing",
        encounters: [encounter],
        encounterDetails: [encounter],
      },
    };
  }
  const events = [
    ...(state.roundResult
      ? [{ type: "round.ended", payload: state.roundResult }]
      : []),
    ...(state.matchResult
      ? [{ type: "match.ended", payload: state.matchResult }]
      : []),
  ].map((event, index) => ({
    ...event,
    eventId: `layout-${index}`,
    roomId: room.roomId,
    sequence: index + 1,
    occurredAt: new Date().toISOString(),
  }));

  await page.addInitScript(
    ({ room, viewer }) => {
      localStorage.setItem(
        "touhouflandre:multi-room",
        JSON.stringify({
          roomId: room.roomId,
          roomCode: room.roomCode,
          guestToken: "layout-test-token",
          memberId: viewer!.memberId,
          role: viewer!.role,
        }),
      );
    },
    { room, viewer: state.viewer },
  );
  await page.route("**/api/rooms/*/snapshot*", (route) =>
    route.fulfill({
      json: {
        ...room,
        viewer: state.viewer,
        members: state.members,
        match: { ...state.match, ...(relay ? { relay } : {}) },
        round: state.round,
        questionScope: state.questionScope,
        gameSequence: events.length,
        events,
      },
    }),
  );
  await page.route("**/api/rooms/*/messages*", (route) =>
    route.fulfill({
      json: { messages: [], hasMore: false, scannedCursor: "layout-chat" },
    }),
  );
  await page.routeWebSocket("**/api/rooms/*/ws", (socket) => {
    socket.onMessage(() => {
      socket.send(JSON.stringify({ type: "hello-ok" }));
      socket.send(
        JSON.stringify({ type: "sync.complete", gameSequence: events.length }),
      );
    });
  });
  await page.goto(`/multi/room/${room.roomCode}`);
  await expect(page.locator("[data-match-summary]")).toBeVisible();
}

async function expectContained(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  for (const selector of [
    "[data-match-summary]",
    "[data-match-status]",
    "[data-board-browser]",
    ".multiplayer-board",
  ]) {
    for (const element of await page.locator(selector).all()) {
      const box = (await element.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(
        page.viewportSize()!.width + 1,
      );
    }
  }
  const dock = await page
    .locator("[data-multiplayer-bottom-dock]")
    .boundingBox();
  const footer = await page.locator(".site-footer").boundingBox();
  expect(dock).not.toBeNull();
  expect(footer).not.toBeNull();
  expect(dock!.y + dock!.height).toBeLessThanOrEqual(footer!.y + 1);
}

test("race boards retain their desktop columns and mobile scrolling", async ({
  page,
}, testInfo) => {
  await openMatch(page, "race-n-player");
  await expect(page.getByRole("combobox", { name: "搜索角色" })).toBeEnabled();
  const self = page.locator('[data-board-variant="self"]');
  const opponent = page.locator('[data-board-variant="opponent"]');
  await expect(self.getByRole("columnheader", { name: "角色" })).toBeVisible();
  await expect(self.getByText("博丽灵梦")).toBeVisible();
  await expect(opponent.getByText("博丽灵梦")).toHaveCount(0);

  const selfBox = (await self.boundingBox())!;
  const opponentBox = (await opponent.boundingBox())!;
  if (page.viewportSize()!.width > 900) {
    expect(opponentBox.x).toBeGreaterThan(selfBox.x + selfBox.width);
    expect(Math.abs(opponentBox.y - selfBox.y)).toBeLessThan(2);
  } else {
    expect(opponentBox.y).toBeGreaterThan(selfBox.y + selfBox.height);
  }
  expect(
    await self.locator(".multiplayer-board-scroll").evaluate((element) => ({
      mask: getComputedStyle(element).maskImage,
      height: element.getBoundingClientRect().height,
    })),
  ).toMatchObject({ mask: "none" });
  await expectContained(page);

  const chat = (await page.getByLabel("聊天输入").boundingBox())!;
  const guess = (await page.getByLabel("搜索角色").boundingBox())!;
  expect(chat.y + chat.height).toBeLessThanOrEqual(guess.y);
  const dock = (await page
    .locator("[data-multiplayer-bottom-dock]")
    .boundingBox())!;
  expect(dock.height).toBeLessThan(220);

  await page.addStyleTag({
    content:
      "nextjs-portal, [data-agentation-root] { display: none !important; }",
  });
  await page.screenshot({ path: testInfo.outputPath("race-light.png") });
  const legendButton = page.getByRole("button", { name: "查看反馈图例" });
  const legendButtonBox = (await legendButton.boundingBox())!;
  expect(legendButtonBox.x).toBeGreaterThan(guess.x + guess.width);
  expect(
    Math.abs(
      legendButtonBox.y +
        legendButtonBox.height / 2 -
        (guess.y + guess.height / 2),
    ),
  ).toBeLessThan(2);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await legendButton.click();
  const legend = page.getByRole("tooltip");
  await expect(legend).toBeVisible();
  await expect(legend).toHaveCSS("opacity", "1");
  const legendBox = (await legend.boundingBox())!;
  expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(legendButtonBox.y);
  expect(legendBox.x).toBeGreaterThanOrEqual(0);
  expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.screenshot({ path: testInfo.outputPath("race-legend.png") });
  await legendButton.click();
  await expect(legend).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.dataset.themeMode = "dark";
    document.documentElement.dataset.themeColor = "iris";
  });
  await expectContained(page);
  await page.screenshot({ path: testInfo.outputPath("race-dark.png") });
});

for (const preset of [
  "race-spectator-playing",
  "race-match-result",
  "race-match-ranking",
] as const) {
  test(`${preset} keeps complete boards contained and actions readable`, async ({
    page,
  }, testInfo) => {
    await openMatch(page, preset);
    await expect(page.getByLabel("搜索角色")).toHaveCount(0);
    await expect(page.locator(".multiplayer-board").first()).toBeVisible();
    if (preset.startsWith("race-match-")) {
      await expect(page.locator("[data-match-finished]")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "再来一局" }),
      ).toBeVisible();
    }
    await expectContained(page);
    await page.screenshot({ path: testInfo.outputPath(`${preset}.png`) });
    if (preset === "race-match-result") {
      const winnerBoard = page.locator('[data-highlight="true"]');
      await expect(winnerBoard).toHaveCount(1);
      await expect(winnerBoard.getByText("博丽灵梦")).toBeVisible();
      await winnerBoard.evaluate((element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      );
      await winnerBoard.screenshot({
        path: testInfo.outputPath("winner-board.png"),
      });
      if (page.viewportSize()!.width <= 680) {
        await winnerBoard
          .locator(".multiplayer-board-scroll")
          .evaluate((element) => {
            element.scrollLeft = element.scrollWidth;
          });
        await winnerBoard.screenshot({
          path: testInfo.outputPath("winner-board-scrolled.png"),
        });
      }
    }
  });
}

test("relay keeps its shared board and turn controls within the page", async ({
  page,
}, testInfo) => {
  await openMatch(page, "relay-playing");
  await expect(page.locator("[data-relay-board]")).toBeVisible();
  await expect(page.getByLabel("搜索角色")).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "主动空过本手" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "回合", exact: true }),
  ).toBeVisible();
  await expectContained(page);
  const board = (await page.locator("[data-relay-board]").boundingBox())!;
  expect(board.x + board.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: testInfo.outputPath("relay.png") });
});
