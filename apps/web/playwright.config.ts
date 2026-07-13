import { defineConfig } from "@playwright/test";

/**
 * Playwright scaffolding (Milestone 0). Browser tests are not part of the
 * default `pnpm check`; run with `pnpm test:e2e` against a dev database.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/health/live",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
