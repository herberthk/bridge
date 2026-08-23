import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Smoke e2e for routes that don't need Firebase. Full authenticated flows
 * (login, exam runner) require a configured backend — run them with
 * E2E_HAS_BACKEND=1 plus a seeded Firebase project/emulator suite.
 */
export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: "bun run dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 420_000,
      },
});
