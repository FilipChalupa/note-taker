import { defineConfig, devices } from "@playwright/test";
import { WEB_URL } from "./tests/e2e/constants";

const fakeMedia = { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] };

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  // Servers are started by the global setup, see tests/e2e/global-setup.ts for why not by `webServer`.
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: WEB_URL,
    extraHTTPHeaders: { "Accept-Language": "en" },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, launchOptions: fakeMedia },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: fakeMedia },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
});
