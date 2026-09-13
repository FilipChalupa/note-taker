/**
 * Pulls finished uploads from the public intake service (apps/intake).
 *
 * Direction of trust: the web app runs inside the LAN and connects out to the intake with a bearer token. The intake
 * never learns this app's address. For each ready item: download, verify size and SHA-256, create a recording,
 * remember the intake id, then acknowledge so the intake deletes its copy. If the acknowledgement fails the item is
 * seen again next time and only acknowledged, not imported twice.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { eq } from "drizzle-orm";
import type { IntakeStatus } from "@note-taker/shared";
import { config, SUPPORTED_MEDIA } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { createRecordingFromPath } from "@/lib/recordings";

interface IntakeItem {
  id: string;
  filename: string;
  mime: string;
  size: number;
  title: string;
  note: string;
  language: string;
  sha256: string;
  createdAt: string;
  completedAt: string;
}

const g = globalThis as unknown as {
  __noteTakerIntake?: { running: boolean; lastRunAt: string | null; lastError: string | null; pending: number | null; collected: number; lastAttempt: number };
};
const state = (g.__noteTakerIntake ??= { running: false, lastRunAt: null, lastError: null, pending: null, collected: 0, lastAttempt: 0 });

const enabled = () => Boolean(config.intakeUrl && config.intakeToken);

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.intakeToken}` };
}

async function intakeFetch(pathname: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const res = await fetch(`${config.intakeUrl}${pathname}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers as Record<string, string> | undefined) },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok && res.status !== 404) throw new Error(`intake responded ${res.status} for ${pathname}`);
  return res;
}

export function intakeStatus(): IntakeStatus {
  return {
    enabled: enabled(),
    url: config.intakeUrl,
    lastRunAt: state.lastRunAt,
    lastError: state.lastError,
    pending: state.pending,
    collected: state.collected,
    running: state.running,
  };
}

/** Called by the poller on every tick; runs at most every INTAKE_POLL_SECONDS. */
export async function maybeCollectIntake(): Promise<void> {
  if (!enabled() || state.running || Date.now() - state.lastAttempt < config.intakePollMs) return;
  await collectIntake();
}

export async function collectIntake(): Promise<IntakeStatus> {
  if (!enabled() || state.running) return intakeStatus();
  state.running = true;
  state.lastAttempt = Date.now();
  try {
    const res = await intakeFetch("/collect/v1/items");
    const { items } = (await res.json()) as { items: IntakeItem[] };
    state.pending = items.length;
    for (const item of items) {
      await collectOne(item);
      state.pending = Math.max(0, (state.pending ?? 1) - 1);
    }
    state.lastError = null;
  } catch (err) {
    state.lastError = (err as Error).message;
    console.warn("[intake] collect failed:", state.lastError);
  } finally {
    state.lastRunAt = new Date().toISOString();
    state.running = false;
  }
  return intakeStatus();
}

async function acknowledge(id: string) {
  await intakeFetch(`/collect/v1/items/${id}`, { method: "DELETE" });
}

async function collectOne(item: IntakeItem): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(item.id)) return;
  const already = db.select().from(schema.intakeImports).where(eq(schema.intakeImports.intakeId, item.id)).get();
  if (already) {
    await acknowledge(item.id);
    return;
  }
  if (!Number.isInteger(item.size) || item.size <= 0 || item.size > config.maxUploadBytes) {
    throw new Error(`intake item ${item.id.slice(0, 8)} has an unacceptable size (${item.size})`);
  }

  const ext = (path.extname(item.filename).toLowerCase().match(/^\.[a-z0-9]{1,5}$/)?.[0] ?? "") || (item.mime.includes("mp4") ? ".m4a" : ".webm");
  const tmpDir = path.join(config.dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `intake-${randomUUID()}${ext}`);
  try {
    const res = await intakeFetch(`/collect/v1/items/${item.id}/file`, {}, 30 * 60_000);
    if (res.status === 404 || !res.body) return; // already gone
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytes += chunk.length;
        if (bytes > item.size) return cb(new Error("intake sent more bytes than declared"));
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), meter, fs.createWriteStream(tmp));
    if (bytes !== item.size) throw new Error(`size mismatch for ${item.id.slice(0, 8)}: ${bytes} != ${item.size}`);
    if (hash.digest("hex") !== item.sha256) throw new Error(`checksum mismatch for ${item.id.slice(0, 8)}`);

    const reference = item.id.slice(0, 8).toUpperCase();
    const notes = [item.note, `Intake ${reference}`].filter(Boolean).join("\n\n");
    const filename = SUPPORTED_MEDIA.test(item.filename) ? item.filename : `${item.filename}${ext}`;
    const rec = createRecordingFromPath(tmp, {
      title: item.title,
      language: item.language || config.defaultLanguage,
      tags: config.intakeTags,
      notes,
      originalFilename: filename,
    });
    db.insert(schema.intakeImports).values({ intakeId: item.id, recordingId: rec.id, collectedAt: new Date().toISOString() }).run();
    state.collected += 1;
    console.log(`[intake] ${reference} -> recording ${rec.id}`);
    await acknowledge(item.id);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}
