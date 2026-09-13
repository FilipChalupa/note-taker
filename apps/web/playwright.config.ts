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
const INTAKE_PORT = 8090;
export const INTAKE_CODE = "e2e-code";
const INTAKE_TOKEN = "e2e-collect-token";
const intakeData =
  process.env.E2E_INTAKE_DATA ??
  (() => {
    const d = path.join(os.tmpdir(), "note-taker-e2e-intake");
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
    process.env.E2E_INTAKE_DATA = d;
    return d;
  })();

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
      command: "node ../intake/server.mjs",
      url: `http://127.0.0.1:${INTAKE_PORT}/healthz`,
      reuseExistingServer: !process.env.CI,
      env: {
        PORT: String(INTAKE_PORT),
        HOST: "127.0.0.1",
        DATA_DIR: intakeData,
        INTAKE_UPLOAD_CODE: INTAKE_CODE,
        INTAKE_COLLECT_TOKEN: INTAKE_TOKEN,
        CHUNK_MB: "1",
        QUIET: "1",
      },
      timeout: 30_000,
    },
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
        INTAKE_URL: `http://127.0.0.1:${INTAKE_PORT}`,
        INTAKE_TOKEN: INTAKE_TOKEN,
        INTAKE_POLL_SECONDS: "1",
        WORKER_POLL_INTERVAL_MS: "500",
      },
      timeout: 60_000,
    },
  ],
});
