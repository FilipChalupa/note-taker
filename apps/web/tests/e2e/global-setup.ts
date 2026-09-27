/**
 * Starts the stub worker, the intake and the production web build once for the whole run.
 *
 * Playwright's own webServer option probes each port before starting it. On WSL2 a connection to a closed local
 * port hangs for about two minutes instead of being refused, which made every local run wait six minutes before
 * the first test. Here servers are started first and readiness is polled with a short per-attempt timeout.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { INTAKE_CODE, INTAKE_PORT, INTAKE_TOKEN, INTAKE_URL, WEB_PORT, WEB_URL, WORKER_PORT } from "./constants";

const WEB_DIR = path.resolve(__dirname, "..", "..");

function tempDir(name: string): string {
  const dir = path.join(os.tmpdir(), `note-taker-e2e-${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function waitFor(url: string, label: string, child: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited with code ${child.exitCode} before it became ready`);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(750) });
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${label} did not become ready at ${url} within ${timeoutMs / 1000} s`);
}

function start(label: string, command: string, args: string[], env: Record<string, string>, cwd: string): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `[${label}] `;
  const forward = (chunk: Buffer) => {
    if (process.env.E2E_SERVER_LOGS) process.stderr.write(chunk.toString().replace(/^/gm, prefix));
  };
  child.stdout?.on("data", forward);
  child.stderr?.on("data", forward);
  return child;
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const dataDir = tempDir("web");
  const importDir = tempDir("import");
  const stubData = tempDir("stub");
  const intakeData = tempDir("intake");
  process.env.E2E_IMPORT_DIR = importDir;
  process.env.E2E_DATA_DIR = dataDir;

  const python = process.env.STUB_PYTHON ?? "python3";
  const children: ChildProcess[] = [];
  const stop = async () => {
    for (const child of children) {
      if (child.pid && child.exitCode === null) {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  };

  try {
    const worker = start(
      "worker",
      python,
      [path.join(WEB_DIR, "..", "worker", "tests", "stub_server.py")],
      { PORT: String(WORKER_PORT), STUB_DATA: stubData, STUB_PHASE_SECONDS: "0.3", STUB_FAKE_CUDA: "1" },
      WEB_DIR,
    );
    const intake = start(
      "intake",
      process.execPath,
      [path.join(WEB_DIR, "..", "intake", "server.mjs")],
      { PORT: String(INTAKE_PORT), HOST: "127.0.0.1", DATA_DIR: intakeData, INTAKE_UPLOAD_CODE: INTAKE_CODE, INTAKE_COLLECT_TOKEN: INTAKE_TOKEN, CHUNK_MB: "1", QUIET: "1" },
      WEB_DIR,
    );
    children.push(worker, intake);
    await Promise.all([waitFor(`http://127.0.0.1:${WORKER_PORT}/health`, "worker", worker), waitFor(`${INTAKE_URL}/healthz`, "intake", intake)]);

    const web = start(
      "web",
      process.execPath,
      ["scripts/start-standalone.mjs"],
      {
        PORT: String(WEB_PORT),
        HOSTNAME: "127.0.0.1",
        WORKER_API_URL: `http://127.0.0.1:${WORKER_PORT}`,
        WORKER_API_KEY: "",
        DATA_DIR: dataDir,
        IMPORT_DIR: importDir,
        INTAKE_URL,
        INTAKE_TOKEN,
        INTAKE_POLL_SECONDS: "1",
        WORKER_POLL_INTERVAL_MS: "500",
        ADMIN_PASSWORD: "e2e-admin",
        NOTE_TAKER_E2E: "1",
      },
      WEB_DIR,
    );
    children.push(web);
    await waitFor(`${WEB_URL}/api/worker/health`, "web", web);
  } catch (err) {
    await stop();
    throw err;
  }
  return stop;
}
