import { defineConfig, devices } from "@playwright/test";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const launchOptions = executablePath ? { executablePath } : undefined;
const pixel7 = devices["Pixel 7"];
const responsiveMobile = process.env.PLAYWRIGHT_RESPONSIVE_FALLBACK === "true"
  ? { viewport: pixel7.viewport, userAgent: pixel7.userAgent }
  : pixel7;

export default defineConfig({
  testDir: "./e2e",
  // Fixture mutations model shared backend state; keep each project deterministic.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/login",
    reuseExistingServer: !process.env.CI,
    env: { NEXT_PUBLIC_E2E_FIXTURES: "true" },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions } },
    { name: "mobile", use: { ...responsiveMobile, launchOptions } },
  ],
});
