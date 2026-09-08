/**
 * Recording service: persistence + orchestration with the worker. Server-side only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { RecordingDetail, RecordingSummary, TranscriptSegment } from "@note-taker/shared";
import { config, recordingDir } from "@/lib/config";
import { db, schema } from "@/lib/db";
import type { RecordingRow } from "@/lib/db/schema";
import { workerClient, WorkerError } from "@/lib/worker-client";

const { recordings } = schema;
const now = () => new Date().toISOString();

// --------------------------------------------------------------- mapping
function toSummary(r: Omit<RecordingRow, "segments">): RecordingSummary {
  return {
    id: r.id,
    title: r.title,
    originalFilename: r.originalFilename,
    language: r.detectedLanguage ?? r.language,
    status: r.status,
    workerStatus: r.workerStatus ?? null,
    progress: r.progress,
    phase: r.phase,
    durationSec: r.durationSec,
    speakerCount: r.speakerCount,
    error: r.error,
    warning: r.warning ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toDetail(r: RecordingRow): RecordingDetail {
  const hasAudio = Boolean(r.audioPath && fs.existsSync(r.audioPath)) || fs.existsSync(r.originalPath);
  return {
    ...toSummary(r),
    speakerNames: r.speakerNames ?? {},
    speakers: r.speakers ?? [],
    segments: r.segments ?? [],
    audioUrl: hasAudio ? `/api/recordings/${r.id}/audio` : null,
  };
}

// ---------------------------------------------------------------- queries
export function listRecordings(): RecordingSummary[] {
  const rows = db
    .select({
      id: recordings.id,
      title: recordings.title,
      originalFilename: recordings.originalFilename,
      originalPath: recordings.originalPath,
      audioPath: recordings.audioPath,
      language: recordings.language,
      minSpeakers: recordings.minSpeakers,
      maxSpeakers: recordings.maxSpeakers,
      status: recordings.status,
      workerTaskId: recordings.workerTaskId,
      workerStatus: recordings.workerStatus,
      progress: recordings.progress,
      phase: recordings.phase,
      error: recordings.error,
      warning: recordings.warning,
      dispatchAttempts: recordings.dispatchAttempts,
      durationSec: recordings.durationSec,
      detectedLanguage: recordings.detectedLanguage,
      speakerCount: recordings.speakerCount,
      speakers: recordings.speakers,
      speakerNames: recordings.speakerNames,
      createdAt: recordings.createdAt,
      updatedAt: recordings.updatedAt,
    })
    .from(recordings)
    .orderBy(desc(recordings.createdAt))
    .all();
  return rows.map(toSummary);
}

export function getRecording(id: string): RecordingDetail | null {
  const row = db.select().from(recordings).where(eq(recordings.id, id)).get();
  return row ? toDetail(row) : null;
}

export function getRecordingRow(id: string): RecordingRow | null {
  return db.select().from(recordings).where(eq(recordings.id, id)).get() ?? null;
}

// ---------------------------------------------------------------- create
export interface CreateRecordingInput {
  title: string;
  language: string;
  minSpeakers?: number;
  maxSpeakers?: number;
  file: File;
}

export async function createRecording(input: CreateRecordingInput): Promise<RecordingDetail> {
  const id = randomUUID();
  const dir = recordingDir(id);
  fs.mkdirSync(dir, { recursive: true });

  const ext = path.extname(input.file.name || "").toLowerCase() || ".bin";
  const originalPath = path.join(dir, `original${ext}`);
  // Stream to disk (do not buffer the whole upload in memory)
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  await pipeline(Readable.fromWeb(input.file.stream() as never), fs.createWriteStream(originalPath));

  const ts = now();
  db.insert(recordings)
    .values({
      id,
      title: input.title.trim() || path.basename(input.file.name, ext) || "Untitled",
      originalFilename: input.file.name || `upload${ext}`,
      originalPath,
      language: input.language,
      minSpeakers: input.minSpeakers ?? null,
      maxSpeakers: input.maxSpeakers ?? null,
      status: "QUEUED",
      phase: "QUEUED",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  // Try to hand off immediately; if the worker is offline the poller retries later.
  await dispatch(id);
  return getRecording(id)!;
}

// --------------------------------------------------------------- updates
export function updateRecording(
  id: string,
  patch: { title?: string; speakerNames?: Record<string, string> },
): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const values: Partial<RecordingRow> = { updatedAt: now() };
  if (typeof patch.title === "string" && patch.title.trim()) values.title = patch.title.trim().slice(0, 200);
  if (patch.speakerNames && typeof patch.speakerNames === "object") {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.speakerNames)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim().slice(0, 80);
    }
    values.speakerNames = cleaned;
  }
  db.update(recordings).set(values).where(eq(recordings.id, id)).run();
  return getRecording(id);
}

export async function deleteRecording(id: string): Promise<boolean> {
  const row = getRecordingRow(id);
  if (!row) return false;
  db.delete(recordings).where(eq(recordings.id, id)).run();
  fs.rmSync(recordingDir(id), { recursive: true, force: true });
  if (row.workerTaskId) void workerClient.deleteTask(row.workerTaskId).catch(() => {});
  return true;
}

export async function retryRecording(id: string): Promise<RecordingDetail | null> {
  const row = getRecordingRow(id);
  if (!row) return null;
  if (!fs.existsSync(row.originalPath)) {
    db.update(recordings)
      .set({ status: "FAILED", error: "ORIGINAL_FILE_MISSING", updatedAt: now() })
      .where(eq(recordings.id, id))
      .run();
    return getRecording(id);
  }
  db.update(recordings)
    .set({
      status: "QUEUED",
      workerTaskId: null,
      workerStatus: null,
      progress: 0,
      phase: "QUEUED",
      error: null,
      warning: null,
      dispatchAttempts: 0,
      // speaker ids are reassigned by a new diarization run, old names would not match
      speakerNames: row.status === "COMPLETED" ? {} : row.speakerNames,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  await dispatch(id);
  return getRecording(id);
}

/**
 * Re-run speaker identification only. Keeps the transcript, sends audio + segments to the worker.
 * Returns an error code when it cannot be started (worker offline, diarization disabled...).
 */
export async function rediarizeRecording(
  id: string,
  opts: { minSpeakers?: number; maxSpeakers?: number },
): Promise<{ recording: RecordingDetail } | { error: string; status: number }> {
  const row = getRecordingRow(id);
  if (!row) return { error: "NOT_FOUND", status: 404 };
  if (row.status !== "COMPLETED") return { error: "NOT_FINISHED", status: 409 };
  const audio = row.audioPath && fs.existsSync(row.audioPath) ? row.audioPath : fs.existsSync(row.originalPath) ? row.originalPath : null;
  if (!audio) return { error: "AUDIO_UNAVAILABLE", status: 409 };
  if (!row.segments?.length) return { error: "NO_TRANSCRIPT", status: 409 };

  let accepted;
  try {
    accepted = await workerClient.submitDiarize(audio, path.basename(audio), row.segments, {
      language: row.detectedLanguage ?? undefined,
      min_speakers: opts.minSpeakers,
      max_speakers: opts.maxSpeakers,
    });
  } catch (err) {
    const status = err instanceof WorkerError && err.status === 409 ? 409 : 503;
    return { error: `WORKER:${(err as Error).message}`, status };
  }
  db.update(recordings)
    .set({
      status: "PROCESSING",
      workerTaskId: accepted.task_id,
      workerStatus: accepted.status,
      progress: 0,
      phase: accepted.queue_position > 0 ? `WORKER_QUEUE:${accepted.queue_position}` : "DIARIZING",
      error: null,
      warning: null,
      minSpeakers: opts.minSpeakers ?? null,
      maxSpeakers: opts.maxSpeakers ?? null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  return { recording: getRecording(id)! };
}

// ---------------------------------------------------- worker orchestration
/** Upload the original file to the worker and store the task id. Safe to call repeatedly. */
export async function dispatch(id: string): Promise<void> {
  const row = getRecordingRow(id);
  if (!row || row.workerTaskId || row.status !== "QUEUED") return;
  try {
    const accepted = await workerClient.submit(row.originalPath, row.originalFilename, {
      language: row.language === "auto" ? undefined : row.language,
      min_speakers: row.minSpeakers ?? undefined,
      max_speakers: row.maxSpeakers ?? undefined,
    });
    db.update(recordings)
      .set({
        workerTaskId: accepted.task_id,
        workerStatus: accepted.status,
        phase: accepted.queue_position > 0 ? `WORKER_QUEUE:${accepted.queue_position}` : "QUEUED",
        error: null,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryable = !(err instanceof WorkerError) || err.retryable;
    db.update(recordings)
      .set({
        status: retryable ? "QUEUED" : "FAILED",
        phase: retryable ? "WAITING_FOR_WORKER" : "FAILED",
        error: msg,
        dispatchAttempts: row.dispatchAttempts + 1,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
  }
}

/** Pull status/result for one in-flight recording from the worker. */
export async function syncRecording(id: string): Promise<void> {
  const row = getRecordingRow(id);
  if (!row || row.status === "COMPLETED" || row.status === "FAILED") return;
  if (!row.workerTaskId) {
    await dispatch(id);
    return;
  }

  let status;
  try {
    status = await workerClient.status(row.workerTaskId);
  } catch (err) {
    if (err instanceof WorkerError && err.status === 404) {
      // Worker lost the task (restart / TTL) - resubmit from the original file
      db.update(recordings)
        .set({ workerTaskId: null, workerStatus: null, status: "QUEUED", progress: 0, updatedAt: now() })
        .where(eq(recordings.id, id))
        .run();
      await dispatch(id);
      return;
    }
    db.update(recordings)
      .set({ phase: "WORKER_UNREACHABLE", error: (err as Error).message, updatedAt: now() })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  if (status.status === "FAILED") {
    db.update(recordings)
      .set({
        status: "FAILED",
        workerStatus: status.status,
        phase: "FAILED",
        progress: status.progress,
        error: status.error ?? "WORKER_UNKNOWN_ERROR",
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  if (status.status !== "COMPLETED") {
    const queued = status.status === "QUEUED";
    const phase =
      queued && status.queue_position && status.queue_position > 0
        ? `WORKER_QUEUE:${status.queue_position}`
        : status.status;
    db.update(recordings)
      .set({
        status: queued ? "QUEUED" : "PROCESSING",
        workerStatus: status.status,
        progress: status.progress,
        phase,
        error: null,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  // COMPLETED -> fetch result + normalized audio
  const result = await workerClient.result(row.workerTaskId);
  if (!result) return;

  const diarizeOnly = result.kind === "diarize";
  const audioExt = result.audio_mime === "audio/wav" ? "wav" : "mp3";
  const audioPath = diarizeOnly && row.audioPath ? row.audioPath : path.join(recordingDir(id), `audio.${audioExt}`);
  if (!diarizeOnly) {
    try {
      await workerClient.downloadAudio(result.audio_url, audioPath);
    } catch (err) {
      // Not fatal: we can still play the original upload
      console.warn(`[recordings] audio download failed for ${id}:`, (err as Error).message);
    }
  }

  const segments: TranscriptSegment[] = result.segments.map((s) => ({
    start: s.start,
    end: s.end,
    speaker: s.speaker,
    text: s.text,
    words: s.words?.map((w) => ({ word: w.word, start: w.start, end: w.end, speaker: w.speaker })),
  }));

  db.update(recordings)
    .set({
      status: "COMPLETED",
      workerStatus: "COMPLETED",
      progress: 100,
      phase: "COMPLETED",
      error: null,
      warning: result.diarized ? null : `DIARIZATION_FAILED:${result.diarization_error ?? "unknown"}`,
      durationSec: diarizeOnly ? row.durationSec : result.duration,
      detectedLanguage: diarizeOnly ? row.detectedLanguage : result.language,
      speakerCount: result.speakers.filter((s) => s !== "UNKNOWN").length,
      speakers: result.speakers,
      speakerNames: {},
      segments,
      audioPath: fs.existsSync(audioPath) ? audioPath : null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();

  // Free space on the worker; it keeps its own copy only as a TTL cache.
  void workerClient.deleteTask(row.workerTaskId).catch(() => {});
}

/** Sync every recording that is still in flight. Called by the poller. */
export async function syncAll(): Promise<void> {
  const inflight = db
    .select({ id: recordings.id, workerTaskId: recordings.workerTaskId, dispatchAttempts: recordings.dispatchAttempts, updatedAt: recordings.updatedAt })
    .from(recordings)
    .where(and(inArray(recordings.status, ["QUEUED", "PROCESSING"])))
    .all();

  for (const r of inflight) {
    // Exponential backoff for dispatch when the worker is offline (max ~2 min between tries)
    if (!r.workerTaskId && r.dispatchAttempts > 0) {
      const wait = Math.min(120_000, config.pollIntervalMs * 2 ** Math.min(r.dispatchAttempts, 6));
      if (Date.now() - new Date(r.updatedAt).getTime() < wait) continue;
    }
    try {
      await syncRecording(r.id);
    } catch (err) {
      console.error(`[recordings] sync failed for ${r.id}:`, (err as Error).message);
    }
  }
}

