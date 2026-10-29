import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { URL } from "node:url";

import { modeConfig } from "../src/gameModes";

test.describe.configure({ mode: "serial", timeout: 300_000 });

const API_BASE_URL = process.env.HSO001_API_BASE_URL ?? "http://127.0.0.1:4000";
const ALLOW_MUTATING_SCENARIOS = process.env.HSO001_ALLOW_WRITES === "1";
const SEARCH_WARMUP_COUNT = 5;
const SEARCH_SAMPLE_COUNT = 30;
const UI_WARMUP_COUNT = 4;
const UI_SAMPLE_COUNT = 30;

const hotHttpAgent = new HttpAgent({ keepAlive: true, maxSockets: 1 });
const hotHttpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 1 });

test.afterAll(() => {
  hotHttpAgent.destroy();
  hotHttpsAgent.destroy();
});

type SummaryStats = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
};

const summaryStats = (samples: number[]): SummaryStats => {
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * ratio) - 1),
    );
    return Number(sorted[index].toFixed(2));
  };
  const total = sorted.reduce((sum, sample) => sum + sample, 0);
  return {
    count: sorted.length,
    min: Number((sorted[0] ?? 0).toFixed(2)),
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: Number((sorted.at(-1) ?? 0).toFixed(2)),
    mean: Number((sorted.length ? total / sorted.length : 0).toFixed(2)),
  };
};

type RawResponse = {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  durationMs: number;
};

type RequestMode = "hot" | "cold";

function agentForUrl(targetUrl: string, requestMode: RequestMode) {
  if (requestMode === "cold") {
    return false;
  }
  return new URL(targetUrl).protocol === "https:"
    ? hotHttpsAgent
    : hotHttpAgent;
}

async function rawRequest(
  targetUrl: string,
  options: {
    headers?: Record<string, string>;
    method?: string;
    requestMode?: RequestMode;
  } = {},
): Promise<RawResponse> {
  const url = new URL(targetUrl);
  const requestImpl = url.protocol === "https:" ? httpsRequest : httpRequest;
  const startedAt = performance.now();
  return await new Promise<RawResponse>((resolve, reject) => {
    const request = requestImpl(
      url,
      {
        method: options.method ?? "GET",
        headers: options.headers,
        agent: agentForUrl(targetUrl, options.requestMode ?? "cold"),
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            headers: response.headers as Record<
              string,
              string | string[] | undefined
            >,
            body: Buffer.concat(chunks),
            durationMs: Number((performance.now() - startedAt).toFixed(2)),
          });
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

async function sampleEndpoint(
  url: string,
  sampleCount: number,
  headers: Record<string, string>,
  requestMode: RequestMode,
) {
  const durations: number[] = [];
  const warmupCount = SEARCH_WARMUP_COUNT;
  let totalBytes = 0;
  let statusCode = 0;
  let failureCount = 0;

  for (let index = 0; index < warmupCount + sampleCount; index += 1) {
    const response = await rawRequest(url, {
      headers: {
        accept: "application/json",
        ...headers,
      },
      requestMode,
    });
    if (index < warmupCount) {
      continue;
    }
    statusCode = response.statusCode;
    totalBytes += response.body.length;
    if (response.statusCode >= 400) {
      failureCount += 1;
    }
    durations.push(response.durationMs);
  }

  return {
    requestMode,
    warmupCount,
    sampleCount,
    requestCount: warmupCount + sampleCount,
    failureCount,
    retryCount: 0,
    statusCode,
    totalBytes,
    statistics: summaryStats(durations),
  };
}

async function createPuzzleSession(
  request: APIRequestContext,
  mode: "daily" | "random",
  body?: unknown,
) {
  const response = await request.post(`/api/puzzles/${mode}`, { data: body });
  expect(response.status()).toBe(200);
  const payload = (await response.json()) as {
    session: { id: string };
    puzzleLabel: string;
  };
  return payload.session.id;
}

async function cleanupPuzzleSession(
  request: APIRequestContext,
  sessionId: string,
) {
  const response = await request.post(`/api/sessions/${sessionId}/forfeit`);
  return response.status();
}

function puzzleRequestBody(
  mode: "daily" | "random",
  scenario: "fresh" | "resume" | "stale",
) {
  if (mode !== "daily") {
    return undefined;
  }
  if (scenario === "resume") {
    return { difficulty: "normal" };
  }
  if (scenario === "stale") {
    return { difficulty: "easy" };
  }
  return undefined;
}

function storageKeyForMode(mode: "daily" | "random") {
  return mode === "daily"
    ? modeConfig.daily.storageKey
    : modeConfig.random.storageKey;
}

async function readSessionId(page: Page, storageKey: string) {
  return await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as { id?: string };
      return typeof parsed.id === "string" ? parsed.id : null;
    } catch {
      return null;
    }
  }, storageKey);
}

type SingleGameFlowResult =
  | {
      mode: "daily" | "random";
      scenario: "fresh" | "resume" | "stale";
      skipped: true;
      reason: string;
      requestCount: number;
      failureCount: number;
      retryCount: number;
    }
  | {
      mode: "daily" | "random";
      scenario: "fresh" | "resume" | "stale";
      skipped?: false;
      seedSessionId: string | null;
      sessionId: string | null;
      readyMs: number;
      requestCount: number;
      failureCount: number;
      retryCount: number;
      cleanupStatus: number;
      requests: string[];
    };

async function sampleSingleGameFlow(
  context: BrowserContext,
  request: APIRequestContext,
  mode: "daily" | "random",
  scenario: "fresh" | "resume" | "stale",
): Promise<SingleGameFlowResult> {
  if (scenario !== "resume" && !ALLOW_MUTATING_SCENARIOS) {
    return {
      mode,
      scenario,
      skipped: true,
      reason:
        "fresh scenarios require HSO001_ALLOW_WRITES=1 and disposable data",
      requestCount: 0,
      failureCount: 0,
      retryCount: 0,
    };
  }

  const storageKey = storageKeyForMode(mode);
  const trackedRequests: string[] = [];
  const failedStatuses: number[] = [];
  const cleanupIds = new Set<string>();
  const seedSessionId =
    scenario === "resume" || scenario === "stale"
      ? await createPuzzleSession(
          request,
          mode,
          puzzleRequestBody(mode, scenario),
        )
      : null;

  const page = await context.newPage();
  let sessionId: string | null = null;
  let readyMs = 0;
  try {
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname.startsWith("/api/")) {
        trackedRequests.push(url.pathname + url.search);
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/") && response.status() >= 400) {
        failedStatuses.push(response.status());
      }
    });

    if (seedSessionId) {
      await page.addInitScript(
        ({ key, id }) => {
          window.localStorage.setItem(key, JSON.stringify({ id }));
        },
        { key: storageKey, id: seedSessionId },
      );
      cleanupIds.add(seedSessionId);
    } else {
      await page.addInitScript(
        ({ key }) => {
          window.localStorage.removeItem(key);
        },
        { key: storageKey },
      );
    }

    const startedAt = performance.now();
    await page.goto(`/single/${mode}`);
    const searchInput = page.getByLabel("搜索东方角色");
    await expect(searchInput).toBeEnabled();
    readyMs = Number((performance.now() - startedAt).toFixed(2));
    sessionId = await readSessionId(page, storageKey);
    if (sessionId) {
      cleanupIds.add(sessionId);
    }
    await page.waitForTimeout(800);
  } finally {
    await page.close();
  }

  let cleanupStatus = 0;
  for (const cleanupId of cleanupIds) {
    cleanupStatus = await cleanupPuzzleSession(request, cleanupId);
  }

  return {
    mode,
    scenario,
    skipped: false,
    seedSessionId,
    sessionId,
    readyMs,
    requestCount: trackedRequests.length,
    failureCount: failedStatuses.length,
    retryCount: 0,
    cleanupStatus,
    requests: trackedRequests,
  };
}

async function sampleSearchLatency(
  context: BrowserContext,
  request: APIRequestContext,
) {
  const queryPairs = [
    { query: "灵梦", expectedLabel: "博丽灵梦" },
    { query: "魔理沙", expectedLabel: "雾雨魔理沙" },
  ];
  const durations: number[] = [];
  const warmupSamples: number[] = [];
  const requestUrls: string[] = [];
  const failedStatuses: number[] = [];
  const seedSessionId = await createPuzzleSession(request, "random");
  const page = await context.newPage();
  let currentSessionId: string | null = null;
  try {
    page.on("request", (req) => {
      const url = new URL(req.url());
      if (url.pathname === "/api/characters/search") {
        requestUrls.push(url.search);
      }
    });
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname === "/api/characters/search" && response.status() >= 400) {
        failedStatuses.push(response.status());
      }
    });

    await page.addInitScript(
      ({ key, id }) => {
        window.localStorage.setItem(key, JSON.stringify({ id }));
      },
      {
        key: storageKeyForMode("random"),
        id: seedSessionId,
      },
    );

    await page.goto("/single/random");
    const input = page.getByLabel("搜索东方角色");
    const suggestions = page.locator(".suggestion-list");
    await expect(input).toBeEnabled();
    for (let index = 0; index < UI_WARMUP_COUNT; index += 1) {
      const pair = queryPairs[index % queryPairs.length];
      await input.press("Escape");
      await expect(suggestions).toBeHidden();
      const startedAt = performance.now();
      await input.fill(pair.query);
      await expect(suggestions).toBeVisible();
      await expect(suggestions.locator(".suggestion").first()).toContainText(
        pair.expectedLabel,
      );
      warmupSamples.push(Number((performance.now() - startedAt).toFixed(2)));
    }

    for (let index = 0; index < UI_SAMPLE_COUNT; index += 1) {
      const pair = queryPairs[index % queryPairs.length];
      await input.press("Escape");
      await expect(suggestions).toBeHidden();
      const startedAt = performance.now();
      await input.fill(pair.query);
      await expect(suggestions).toBeVisible();
      await expect(suggestions.locator(".suggestion").first()).toContainText(
        pair.expectedLabel,
      );
      durations.push(Number((performance.now() - startedAt).toFixed(2)));
    }
    currentSessionId = await readSessionId(page, storageKeyForMode("random"));
  } finally {
    await page.close();
    const cleanupIds = new Set<string>([seedSessionId]);
    if (currentSessionId) {
      cleanupIds.add(currentSessionId);
    }
    for (const cleanupId of cleanupIds) {
      await cleanupPuzzleSession(request, cleanupId);
    }
  }

  return {
    requestCount: requestUrls.length,
    failureCount: failedStatuses.length,
    retryCount: 0,
    requests: requestUrls,
    warmupSamples,
    samples: durations,
    statistics: summaryStats(durations),
  };
}

test.describe("HSO-001 baseline", () => {
  test("API search, payload and single-game load baselines", async ({
    request,
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chromium");

    const catalogFull = await rawRequest(`${API_BASE_URL}/api/catalog/full`, {
      headers: { accept: "application/json", "accept-encoding": "identity" },
    });
    expect(catalogFull.statusCode).toBe(200);
    const catalogFullPayload = JSON.parse(
      catalogFull.body.toString("utf8"),
    ) as {
      version: string;
      characters: Array<{ enabledAsGuess: boolean }>;
      works: unknown[];
    };

    const catalogCharactersIdentity = await rawRequest(
      `${API_BASE_URL}/api/catalog/characters`,
      {
        headers: { accept: "application/json", "accept-encoding": "identity" },
      },
    );
    const catalogCharactersGzip = await rawRequest(
      `${API_BASE_URL}/api/catalog/characters`,
      {
        headers: { accept: "application/json", "accept-encoding": "gzip" },
      },
    );
    const catalogFullGzip = await rawRequest(
      `${API_BASE_URL}/api/catalog/full`,
      {
        headers: { accept: "application/json", "accept-encoding": "gzip" },
      },
    );

    const searchUrl = `${API_BASE_URL}/api/characters/search?q=%E7%81%B5%E6%A2%A6&catalogVersion=${encodeURIComponent(catalogFullPayload.version)}`;
    const searchHot = await sampleEndpoint(
      searchUrl,
      SEARCH_SAMPLE_COUNT,
      {},
      "hot",
    );
    const searchCold = await sampleEndpoint(
      searchUrl,
      SEARCH_SAMPLE_COUNT,
      {},
      "cold",
    );

    const randomFresh = await sampleSingleGameFlow(
      page.context(),
      request,
      "random",
      "fresh",
    );
    const randomResume = await sampleSingleGameFlow(
      page.context(),
      request,
      "random",
      "resume",
    );
    const dailyFresh = await sampleSingleGameFlow(
      page.context(),
      request,
      "daily",
      "fresh",
    );
    const dailyResume = await sampleSingleGameFlow(
      page.context(),
      request,
      "daily",
      "resume",
    );
    const dailyStale = await sampleSingleGameFlow(
      page.context(),
      request,
      "daily",
      "stale",
    );

    console.log(
      JSON.stringify(
        {
          environment: {
            node: process.version,
            platform: process.platform,
            cpus: os.cpus().length,
            memoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(2)),
          },
          catalog: {
            version: catalogFullPayload.version,
            characters: catalogFullPayload.characters.length,
            guessable: catalogFullPayload.characters.filter(
              (character) => character.enabledAsGuess,
            ).length,
            works: catalogFullPayload.works.length,
          },
          payloads: {
            catalogCharacters: {
              identityBytes: catalogCharactersIdentity.body.length,
              gzipBytes: catalogCharactersGzip.body.length,
            },
            catalogFull: {
              identityBytes: catalogFull.body.length,
              gzipBytes: catalogFullGzip.body.length,
            },
          },
          search: {
            hot: searchHot,
            cold: searchCold,
          },
          singleGame: [
            randomFresh,
            randomResume,
            dailyFresh,
            dailyResume,
            dailyStale,
          ],
        },
        null,
        2,
      ),
    );
  });

  test("search suggestions appear after typing", async ({ page, request }) => {
    const result = await sampleSearchLatency(page.context(), request);
    console.log(
      JSON.stringify(
        {
          viewport: {
            name: test.info().project.name,
            width: test.info().project.use?.viewport?.width ?? null,
            height: test.info().project.use?.viewport?.height ?? null,
          },
          search: result,
        },
        null,
        2,
      ),
    );
    expect(result.samples).toHaveLength(UI_SAMPLE_COUNT);
  });
});
