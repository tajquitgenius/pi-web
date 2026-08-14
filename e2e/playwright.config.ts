import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["html", { open: "never" }], ["list"]] : [["list"]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  outputDir: process.env.PI_WEB_E2E_OUTPUT_DIR || "test-results",
  use: {
    trace: "on-first-retry",
    // baseURL is injected per-test by the fixture in lib/test.ts from the
    // server started in global-setup (random free port).
  },
  projects: [
    {
      name: "Desktop Chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "Desktop Firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "Desktop Safari", use: { ...devices["Desktop Safari"] } },
    { name: "Mobile Chrome", use: { ...devices["Pixel 5"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 15 Pro"] } },
    // iPad portrait (810px) -> mobile layout; landscape (~1080px) -> desktop layout.
    { name: "iPad", use: { ...devices["iPad (gen 7)"] } },
    { name: "iPad landscape", use: { ...devices["iPad (gen 7) landscape"] } },
  ],
});
