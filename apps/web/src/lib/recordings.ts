/**
 * Recording service: persistence + orchestration with the worker. Server-side only.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  BulkAction,
  RecordingDetail,
  RecordingListQuery,
  RecordingPage,
  RecordingSummary,
  SearchHit,
  SegmentEdit,
  TagCount,
  TranscriptSegment,
} from "@note-taker/shared";
import { config, recordingDir } from "@/lib/config";
import { db, rawDb, schema } from "@/lib/db";
import { buildInitialPrompt } from "@/lib/settings";
import { notifyAll, recordingNotification } from "@/lib/push";
import { forgetSample, learnVoice, suggestSpeakers } from "@/lib/voices";
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
    tags: r.tags ?? [],
    favorite: Boolean(r.favorite),
    archived: Boolean(r.archived),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toDetail(r: RecordingRow): RecordingDetail {
  const hasAudio = Boolean(r.audioPath && fs.existsSync(r.audioPath)) || fs.existsSync(r.originalPath);
  return {
    ...toSummary(r),
    hints: r.hints ?? null,
    notes: r.notes ?? null,
    speakerSuggestions: r.speakerSuggestions ?? {},
    speakersWithEmbedding: Object.keys(r.speakerEmbeddings ?? {}),
    speakerNames: r.speakerNames ?? {},
    speakers: r.speakers ?? [],
    segments: r.segments ?? [],
    audioUrl: hasAudio ? `/api/recordings/${r.id}/audio` : null,
  };
}

// ---------------------------------------------------------------- queries
function selectSummaryRows() {
  return db
    .select({
      id: recordings.id,
      title: recordings.title,
      originalFilename: recordings.originalFilename,
      originalPath: recordings.originalPath,
      audioPath: recordings.audioPath,
      language: recordings.language,
      hints: recordings.hints,
      tags: recordings.tags,
      notes: recordings.notes,
      favorite: recordings.favorite,
      archived: recordings.archived,
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
      speakerEmbeddings: recordings.speakerEmbeddings,
      speakerSuggestions: recordings.speakerSuggestions,
      createdAt: recordings.createdAt,
      updatedAt: recordings.updatedAt,
    })
    .from(recordings)
    .orderBy(desc(recordings.createdAt))
    .all();
}

const collator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

/** Filtered + sorted summaries. Archived recordings are hidden unless the view asks for them. */
export function listRecordings(query: RecordingListQuery = {}): RecordingSummary[] {
  const tag = query.tag?.trim().toLowerCase();
  const view = query.view ?? "active";
  let rows = selectSummaryRows().filter((r) => {
    if (tag && !(r.tags ?? []).some((t) => t.toLowerCase() === tag)) return false;
    if (view === "active") return !r.archived;
    if (view === "favorites") return r.favorite && !r.archived;
    if (view === "archived") return r.archived;
    return true;
  });
  const sort = query.sort ?? "newest";
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt);
      case "title":
        return collator.compare(a.title, b.title);
      case "longest":
        return (b.durationSec ?? -1) - (a.durationSec ?? -1);
      case "shortest":
        return (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity);
      default:
        return b.createdAt.localeCompare(a.createdAt);
    }
  });
  return rows.map(toSummary);
}

export function pageRecordings(query: RecordingListQuery = {}): RecordingPage {
  const all = listRecordings(query);
  const pageSize = Math.min(200, Math.max(5, query.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

/** Apply one action to many recordings; returns the number affected. */
export async function bulkAction(ids: string[], action: BulkAction, tag?: string): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const row = getRecordingRow(id);
    if (!row) continue;
    if (action === "delete") {
      if (await deleteRecording(id)) n += 1;
      continue;
    }
    const values: Partial<RecordingRow> = { updatedAt: now() };
    if (action === "archive") values.archived = true;
    if (action === "unarchive") values.archived = false;
    if (action === "favorite") values.favorite = true;
    if (action === "unfavorite") values.favorite = false;
    if (action === "addTag" && tag) values.tags = normalizeTags([...(row.tags ?? []), tag]);
    if (action === "removeTag" && tag) values.tags = (row.tags ?? []).filter((t) => t.toLowerCase() !== tag.trim().toLowerCase());
    db.update(recordings).set(values).where(eq(recordings.id, id)).run();
    if (values.tags) indexRecording(id);
    n += 1;
  }
  return n;
}

/** Distinct tags with usage counts, most used first. */
export function listTags(): TagCount[] {
  const counts = new Map<string, number>();
  for (const r of db.select({ tags: recordings.tags }).from(recordings).all()) {
    for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** "a, b; c" or "a\nb" -> ["a", "b", "c"], de-duplicated case-insensitively, max 20. */
export function normalizeTags(input: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(input) ? input : (input ?? "").split(/[,;\n]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const tag = String(t).trim().replace(/\s+/g, " ").slice(0, 40);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= 20) break;
  }
  return out;
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
  tags?: string | string[];
  notes?: string;
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

  return insertRecording({ id, originalPath, originalFilename: input.file.name || `upload${ext}`, ...input });
}

/** Register an audio file that is already on disk (watch-folder import). The file is moved into DATA_DIR. */
export function createRecordingFromPath(
  sourcePath: string,
  input: { title?: string; language: string; hints?: string; tags?: string | string[] },
): RecordingDetail {
  const id = randomUUID();
  const dir = recordingDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(sourcePath).toLowerCase() || ".bin";
  const originalPath = path.join(dir, `original${ext}`);
  try {
    fs.renameSync(sourcePath, originalPath);
  } catch {
    fs.copyFileSync(sourcePath, originalPath);
    fs.unlinkSync(sourcePath);
  }
  return insertRecording({ id, originalPath, originalFilename: path.basename(sourcePath), title: input.title ?? "", ...input });
}

function insertRecording(input: {
  id: string;
  originalPath: string;
  originalFilename: string;
  title: string;
  language: string;
  hints?: string;
  tags?: string | string[];
  notes?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
}): RecordingDetail {
  const ext = path.extname(input.originalFilename).toLowerCase();
  const ts = now();
  db.insert(recordings)
    .values({
      id: input.id,
      title: input.title.trim() || path.basename(input.originalFilename, ext) || "Untitled",
      originalFilename: input.originalFilename,
      originalPath: input.originalPath,
      language: input.language,
      hints: input.hints?.trim() || null,
      tags: normalizeTags(input.tags),
      notes: input.notes?.trim().slice(0, 20_000) || null,
      minSpeakers: input.minSpeakers ?? null,
      maxSpeakers: input.maxSpeakers ?? null,
      status: "QUEUED",
      phase: "QUEUED",
      createdAt: ts,
      updatedAt: ts,
    })
    .run();

  // Hand off in the background so the upload response is immediate; the poller retries if needed.
  void dispatch(input.id).catch((err) => console.error(`[recordings] dispatch failed for ${input.id}:`, (err as Error).message));
  return getRecording(input.id)!;
}

// --------------------------------------------------------------- updates
export function updateRecording(
  id: string,
  patch: {
    title?: string;
    speakerNames?: Record<string, string>;
    hints?: string | null;
    tags?: string | string[];
    notes?: string | null;
    favorite?: boolean;
    archived?: boolean;
  },
): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const values: Partial<RecordingRow> = { updatedAt: now() };
  if (typeof patch.favorite === "boolean") values.favorite = patch.favorite;
  if (typeof patch.archived === "boolean") values.archived = patch.archived;
  if (typeof patch.title === "string" && patch.title.trim()) values.title = patch.title.trim().slice(0, 200);
  if (patch.hints !== undefined) values.hints = patch.hints?.trim().slice(0, 2000) || null;
  if (patch.tags !== undefined) values.tags = normalizeTags(patch.tags);
  if (patch.notes !== undefined) values.notes = patch.notes?.trim().slice(0, 20_000) || null;
  if (patch.speakerNames && typeof patch.speakerNames === "object") {
    const cleaned: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.speakerNames)) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v.trim().slice(0, 80);
    }
    values.speakerNames = cleaned;
    // Learn / update known voices from the names the user gave
    const embeddings = row.speakerEmbeddings ?? {};
    const before = row.speakerNames ?? {};
    for (const speaker of new Set([...Object.keys(before), ...Object.keys(cleaned)])) {
      const vec = embeddings[speaker];
      if (!vec) continue;
      const name = cleaned[speaker];
      if (name && name !== before[speaker]) {
        forgetSample(id, speaker);
        learnVoice(name, vec, id, speaker);
      } else if (!name && before[speaker]) {
        forgetSample(id, speaker);
      }
    }
    // A named speaker no longer needs a suggestion
    const suggestions = { ...(row.speakerSuggestions ?? {}) };
    for (const speaker of Object.keys(cleaned)) delete suggestions[speaker];
    values.speakerSuggestions = suggestions;
  }
  db.update(recordings).set(values).where(eq(recordings.id, id)).run();
  if (values.title !== undefined || values.tags !== undefined || values.notes !== undefined) indexRecording(id);
  return getRecording(id);
}

/** Apply known-voice suggestions as speaker names (all, or only the given speaker ids). */
export function applySpeakerSuggestions(id: string, speakers?: string[]): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const names = { ...(row.speakerNames ?? {}) };
  for (const [speaker, s] of Object.entries(row.speakerSuggestions ?? {})) {
    if (speakers && !speakers.includes(speaker)) continue;
    names[speaker] = s.name;
  }
  return updateRecording(id, { speakerNames: names });
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
  const embeddings = { ...(row.speakerEmbeddings ?? {}) };
  delete embeddings[from];
  const suggestions = { ...(row.speakerSuggestions ?? {}) };
  delete suggestions[from];
  forgetSample(id, from);
  db.update(recordings).set({ speakerEmbeddings: embeddings, speakerSuggestions: suggestions }).where(eq(recordings.id, id)).run();
  saveSegments(id, row, segments, names);
  return getRecording(id);
}

/** Replace the whole transcript state (undo). Segment shape is validated loosely. */
export function replaceTranscript(
  id: string,
  segments: TranscriptSegment[],
  speakers: string[],
  speakerNames: Record<string, string>,
): RecordingDetail | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const clean: TranscriptSegment[] = segments
    .filter((s) => s && typeof s.text === "string" && Number.isFinite(s.start) && Number.isFinite(s.end))
    .slice(0, 50_000)
    .map((s) => ({
      start: s.start,
      end: s.end,
      speaker: /^[A-Za-z0-9_]{1,40}$/.test(s.speaker) ? s.speaker : "UNKNOWN",
      text: s.text.slice(0, 5000),
      words: Array.isArray(s.words) ? s.words.slice(0, 2000) : undefined,
    }));
  const used = new Set(clean.map((s) => s.speaker));
  const ordered = [...speakers.filter((x) => typeof x === "string" && used.has(x)), ...[...used].filter((x) => !speakers.includes(x))];
  const names: Record<string, string> = {};
  for (const [k, v] of Object.entries(speakerNames ?? {})) if (typeof v === "string" && v.trim()) names[k] = v.trim().slice(0, 80);
  db.update(recordings)
    .set({ segments: clean, speakers: ordered, speakerCount: ordered.filter((x) => x !== "UNKNOWN").length, speakerNames: names, updatedAt: now() })
    .where(eq(recordings.id, id))
    .run();
  indexRecording(id);
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
  const body = [(row.tags ?? []).join(" "), row.notes ?? "", ...(row.segments ?? []).map((s) => s.text)].filter(Boolean).join(" ");
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
  for (const speaker of Object.keys(row.speakerEmbeddings ?? {})) forgetSample(id, speaker);
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
    void notifyAll(recordingNotification({ id, title: row.title, status: "FAILED" })).catch(() => {});
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
      speakerEmbeddings: result.speaker_embeddings ?? null,
      speakerSuggestions: suggestSpeakers(result.speaker_embeddings),
      segments,
      audioPath: fs.existsSync(audioPath) ? audioPath : null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();

  indexRecording(id);
  void notifyAll(
    recordingNotification({ id, title: row.title, status: "COMPLETED", speakerCount: result.speakers.filter((s) => s !== "UNKNOWN").length }),
  ).catch(() => {});

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

