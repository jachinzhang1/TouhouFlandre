import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

const srcRoot = fileURLToPath(new URL("./src", import.meta.url));
export default defineConfig({
  resolve: {
    alias: { "@": srcRoot },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    environmentOptions: {
      jsdom: { url: "http://localhost:3000/" },
    },
  },
});
