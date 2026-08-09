import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const useWebServer = process.env.PLAYWRIGHT_USE_WEB_SERVER !== "0";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
  ],
  webServer: useWebServer
    ? {
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? "pnpm dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 120_000,
        env: {
          ...process.env,
          MULTI_JOIN_RATE_LIMIT: process.env.MULTI_JOIN_RATE_LIMIT ?? "1000",
        },
      }
    : undefined,
});
