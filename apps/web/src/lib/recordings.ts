/**
 * Recording service: persistence + orchestration with the worker. Server-side only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { RecordingDetail, RecordingSummary, SearchHit, SegmentEdit, TranscriptSegment } from "@note-taker/shared";
import { config, recordingDir } from "@/lib/config";
import { db, rawDb, schema } from "@/lib/db";
import { buildInitialPrompt } from "@/lib/settings";
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
    hints: r.hints ?? null,
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
      hints: recordings.hints,
      minSpeakers: recordings.minSpeakers,
      maxSpeakers: recordings.maxSpeakers,
      status: recordings.status,
      taskKind: recordings.taskKind,
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
  hints?: string;
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
      hints: input.hints?.trim() || null,
      minSpeakers: input.minSpeakers ?? null,
      maxSpeakers: input.maxSpeakers ?? null,
      status: "QUEUED",
      phase: "QUEUED",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  // Hand off in the background so the upload response is immediate; the poller retries if needed.
  void dispatch(id).catch((err) => console.error(`[recordings] dispatch failed for ${id}:`, (err as Error).message));
  return getRecording(id)!;
}

// --------------------------------------------------------------- updates
export function updateRecording(
  id: string,
  patch: { title?: string; speakerNames?: Record<string, string>; hints?: string | null },
): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const values: Partial<RecordingRow> = { updatedAt: now() };
  if (typeof patch.title === "string" && patch.title.trim()) values.title = patch.title.trim().slice(0, 200);
  if (patch.hints !== undefined) values.hints = patch.hints?.trim().slice(0, 2000) || null;
  if (patch.speakerNames && typeof patch.speakerNames === "object") {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.speakerNames)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim().slice(0, 80);
    }
    values.speakerNames = cleaned;
  }
  db.update(recordings).set(values).where(eq(recordings.id, id)).run();
  if (values.title) indexRecording(id);
  return getRecording(id);
}

/** Apply text / speaker edits to individual segments. */
export function editSegments(id: string, edits: SegmentEdit[]): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const segments = [...(row.segments ?? [])];
  for (const e of edits) {
    const seg = segments[e.index];
    if (!seg) continue;
    const next: TranscriptSegment = { ...seg };
    if (typeof e.text === "string") {
      const text = e.text.replace(/\s+/g, " ").trim();
      if (text && text !== seg.text) {
        next.text = text;
        // Keep word timings only when the word count is unchanged (pure corrections);
        // otherwise fall back to segment-level highlighting.
        const words = text.split(" ");
        next.words = seg.words && seg.words.length === words.length ? seg.words.map((w, i) => ({ ...w, word: words[i] })) : undefined;
      }
    }
    if (typeof e.speaker === "string" && /^[A-Za-z0-9_]{1,40}$/.test(e.speaker)) {
      next.speaker = e.speaker;
      next.words = next.words?.map((w) => ({ ...w, speaker: e.speaker }));
    }
    segments[e.index] = next;
  }
  saveSegments(id, row, segments);
  return getRecording(id);
}

/** Merge speaker `from` into `into` across the whole transcript. */
export function mergeSpeakers(id: string, from: string, into: string): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row || from === into) return row ? getRecording(id) : null;
  const segments = (row.segments ?? []).map((seg) =>
    seg.speaker === from
      ? { ...seg, speaker: into, words: seg.words?.map((w) => (w.speaker === from ? { ...w, speaker: into } : w)) }
      : seg,
  );
  const names = { ...(row.speakerNames ?? {}) };
  if (!names[into] && names[from]) names[into] = names[from];
  delete names[from];
  saveSegments(id, row, segments, names);
  return getRecording(id);
}

function saveSegments(id: string, row: RecordingRow, segments: TranscriptSegment[], speakerNames?: Record<string, string>) {
  // Speaker order: keep existing order, append newly introduced ids, drop unused ones
  const used = new Set(segments.map((s) => s.speaker));
  const speakers = [...(row.speakers ?? []).filter((s) => used.has(s)), ...[...used].filter((s) => !(row.speakers ?? []).includes(s))];
  db.update(recordings)
    .set({
      segments,
      speakers,
      speakerCount: speakers.filter((s) => s !== "UNKNOWN").length,
      ...(speakerNames ? { speakerNames } : {}),
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  indexRecording(id);
}

// ------------------------------------------------------------- full text
export function indexRecording(id: string): void {
  const row = getRecordingRow(id);
  const sql = rawDb();
  sql.prepare("DELETE FROM recordings_fts WHERE recording_id = ?").run(id);
  if (!row || row.status !== "COMPLETED") return;
  const body = (row.segments ?? []).map((s) => s.text).join(" ");
  sql.prepare("INSERT INTO recordings_fts (recording_id, title, body) VALUES (?, ?, ?)").run(id, row.title, body);
}

/** Full-text search over titles and transcripts. Terms are AND-ed, each matched as a prefix. */
export function searchRecordings(query: string, limit = 30): SearchHit[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*()]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t}"*`).join(" ");
  const rows = rawDb()
    .prepare(
      `SELECT f.recording_id AS id, r.title, r.created_at AS createdAt, r.duration_sec AS durationSec,
              snippet(recordings_fts, 2, '\u0001', '\u0002', '…', 18) AS snippet
         FROM recordings_fts f JOIN recordings r ON r.id = f.recording_id
        WHERE recordings_fts MATCH ?
        ORDER BY bm25(recordings_fts, 5.0, 1.0)
        LIMIT ?`,
    )
    .all(match, limit) as SearchHit[];
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return rows.map((r) => ({ ...r, snippet: esc(r.snippet).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>") }));
}

export async function deleteRecording(id: string): Promise<boolean> {
  const row = getRecordingRow(id);
  if (!row) return false;
  db.delete(recordings).where(eq(recordings.id, id)).run();
  rawDb().prepare("DELETE FROM recordings_fts WHERE recording_id = ?").run(id);
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
      taskKind: "transcribe",
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
  indexRecording(id);
  void dispatch(id).catch(() => {});
  return getRecording(id);
}

/**
 * Queue a speakers-only re-run. Keeps the transcript; the poller hands audio + segments to the
 * worker (task kind "diarize") as soon as it is reachable.
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

  db.update(recordings)
    .set({
      status: "QUEUED",
      taskKind: "diarize",
      workerTaskId: null,
      workerStatus: null,
      progress: 0,
      phase: "QUEUED",
      error: null,
      warning: null,
      dispatchAttempts: 0,
      minSpeakers: opts.minSpeakers ?? null,
      maxSpeakers: opts.maxSpeakers ?? null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  void dispatch(id).catch(() => {});
  return { recording: getRecording(id)! };
}

// ---------------------------------------------------- worker orchestration
/** Upload the original file to the worker and store the task id. Safe to call repeatedly. */
export async function dispatch(id: string): Promise<void> {
  const row = getRecordingRow(id);
  if (!row || row.workerTaskId || row.status !== "QUEUED") return;
  try {
    let accepted;
    if (row.taskKind === "diarize") {
      const audio = row.audioPath && fs.existsSync(row.audioPath) ? row.audioPath : row.originalPath;
      accepted = await workerClient.submitDiarize(audio, path.basename(audio), row.segments, {
        language: row.detectedLanguage ?? undefined,
        min_speakers: row.minSpeakers ?? undefined,
        max_speakers: row.maxSpeakers ?? undefined,
      });
    } else {
      accepted = await workerClient.submit(row.originalPath, row.originalFilename, {
        language: row.language === "auto" ? undefined : row.language,
        min_speakers: row.minSpeakers ?? undefined,
        max_speakers: row.maxSpeakers ?? undefined,
        initial_prompt: buildInitialPrompt(row.hints),
      });
    }
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
    if (!retryable && row.taskKind === "diarize") {
      // Speakers-only re-run rejected (e.g. diarization disabled): keep the existing transcript
      db.update(recordings)
        .set({ status: "COMPLETED", taskKind: "transcribe", phase: "COMPLETED", warning: `DIARIZATION_FAILED:${msg}`, updatedAt: now() })
        .where(eq(recordings.id, id))
        .run();
      return;
    }
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

  if (status.status === "FAILED" && row.taskKind === "diarize") {
    // Keep the existing transcript, just report that speakers could not be recomputed
    db.update(recordings)
      .set({
        status: "COMPLETED",
        taskKind: "transcribe",
        workerTaskId: null,
        workerStatus: null,
        progress: 100,
        phase: "COMPLETED",
        warning: `DIARIZATION_FAILED:${status.error ?? "WORKER_UNKNOWN_ERROR"}`,
        updatedAt: now(),
      })
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
      taskKind: "transcribe",
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

  indexRecording(id);

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

