import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const WEB_PORT = 3124;
const WORKER_PORT = 8765;
const dataDir = process.env.E2E_DATA_DIR ?? fs.mkdtempSync(path.join(os.tmpdir(), "note-taker-e2e-"));
const stubData = fs.mkdtempSync(path.join(os.tmpdir(), "note-taker-stub-"));
// The config is evaluated again in every worker process, so derive paths once and pass them on via env.
const importDir =
  process.env.E2E_IMPORT_DIR ??
  (() => {
    const d = path.join(os.tmpdir(), "note-taker-e2e-import");
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    process.env.E2E_IMPORT_DIR = d;
    return d;
  })();
const python = process.env.STUB_PYTHON ?? "python3";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    extraHTTPHeaders: { "Accept-Language": "en" },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 }, launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } },
      testIgnore: /mobile\.spec\.ts/,
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } },
      testMatch: /mobile\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: `${python} ../worker/tests/stub_server.py`,
      url: `http://127.0.0.1:${WORKER_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      env: { PORT: String(WORKER_PORT), STUB_DATA: stubData, STUB_PHASE_SECONDS: "0.3", STUB_FAKE_CUDA: "1" },
      timeout: 60_000,
    },
    {
      command: "node scripts/start-standalone.mjs",
      url: `http://127.0.0.1:${WEB_PORT}/api/worker/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(WEB_PORT),
        HOSTNAME: "127.0.0.1",
        WORKER_API_URL: `http://127.0.0.1:${WORKER_PORT}`,
        WORKER_API_KEY: "",
        DATA_DIR: dataDir,
        IMPORT_DIR: importDir,
        WORKER_POLL_INTERVAL_MS: "500",
      },
      timeout: 60_000,
    },
  ],
});
