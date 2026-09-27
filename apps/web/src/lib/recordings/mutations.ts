/** Creating, editing and deleting recordings and their transcripts. Server-side only. */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { BulkAction, RecordingDetail, SegmentEdit, TranscriptMutationResult, TranscriptSegment } from "@note-taker/shared";
import { recordingDir } from "@/lib/config";
import { db, rawDb, schema } from "@/lib/db";
import { forgetSample, learnVoice } from "@/lib/voices";
import type { RecordingRow } from "@/lib/db/schema";
import { workerClient } from "@/lib/worker-client";
import { now, mutationResult, getRecording, getRecordingRow, normalizeTags } from "./core";
import { indexRecording } from "./search";
import { dispatch } from "./worker-sync";

const { recordings } = schema;

export interface CreateRecordingInput {
  title: string;
  language: string;
  hints?: string;
  tags?: string | string[];
  notes?: string;
  minSpeakers?: number;
  maxSpeakers?: number;
  /** API token that created it, so submit-only tokens can read back their own recordings. */
  ownerTokenId?: string;
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
  input: { title?: string; language: string; hints?: string; tags?: string | string[]; notes?: string; originalFilename?: string; ownerTokenId?: string },
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
  return insertRecording({ id, originalPath, ...input, originalFilename: input.originalFilename || path.basename(sourcePath), title: input.title ?? "" });
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
  ownerTokenId?: string;
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
      ownerTokenId: input.ownerTokenId ?? null,
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
  return editSegmentsPatch(id, edits) ? getRecording(id) : null;
}

/** Same as editSegments but returns only the changed segments (indices stay stable unless times reorder). */
export function editSegmentsPatch(id: string, edits: SegmentEdit[]): TranscriptMutationResult | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const segments = [...(row.segments ?? [])];
  const changed: Record<number, TranscriptSegment> = {};
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
    // Time edits: clamp to sane bounds and rescale word timings into the new range
    const start = typeof e.start === "number" && Number.isFinite(e.start) ? Math.max(0, e.start) : next.start;
    const end = typeof e.end === "number" && Number.isFinite(e.end) ? Math.max(start + 0.1, e.end) : Math.max(start + 0.1, next.end);
    if (start !== next.start || end !== next.end) {
      const oldSpan = Math.max(0.001, next.end - next.start);
      const scale = (end - start) / oldSpan;
      next.words = next.words?.map((w) => ({
        ...w,
        start: w.start == null ? w.start : Math.round((start + (w.start - seg.start) * scale) * 1000) / 1000,
        end: w.end == null ? w.end : Math.round((start + (w.end - seg.start) * scale) * 1000) / 1000,
      }));
      next.start = Math.round(start * 1000) / 1000;
      next.end = Math.round(end * 1000) / 1000;
    }
    segments[e.index] = next;
    changed[e.index] = next;
  }
  const order = segments.map((sg, i) => i);
  segments.sort((a, b) => a.start - b.start);
  const reordered = segments.some((sg, i) => sg !== (row.segments ?? [])[order[i]] && !(i in changed));
  saveSegments(id, row, segments);
  // If sorting moved segments around, the client cannot apply an index patch -> send a full splice
  return mutationResult(id, reordered ? { kind: "splice", index: 0, remove: (row.segments ?? []).length, insert: segments } : { kind: "edits", segments: changed });
}

/**
 * Split the segment at `index` into two at character `position` of its text.
 * The boundary time comes from word timestamps when available, otherwise proportionally to text length.
 */
export function splitSegment(id: string, index: number, position: number): RecordingDetail | null {
  return splitSegmentPatch(id, index, position) ? getRecording(id) : null;
}

export function splitSegmentPatch(id: string, index: number, position: number): TranscriptMutationResult | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  const segments = [...(row.segments ?? [])];
  const seg = segments[index];
  if (!seg) return mutationResult(id, { kind: "none" });
  const text = seg.text;
  const pos = Math.max(0, Math.min(text.length, position));
  const left = text.slice(0, pos).trim();
  const right = text.slice(pos).trim();
  if (!left || !right) return mutationResult(id, { kind: "none" });

  let boundary: number;
  let leftWords: TranscriptSegment["words"];
  let rightWords: TranscriptSegment["words"];
  const leftCount = left.split(/\s+/).length;
  if (seg.words && seg.words.length >= 2 && leftCount < seg.words.length) {
    leftWords = seg.words.slice(0, leftCount);
    rightWords = seg.words.slice(leftCount);
    const lastLeft = [...leftWords].reverse().find((w) => w.end != null)?.end;
    const firstRight = rightWords.find((w) => w.start != null)?.start;
    boundary = lastLeft != null && firstRight != null ? (lastLeft + firstRight) / 2 : lastLeft ?? firstRight ?? seg.start + (seg.end - seg.start) * (pos / text.length);
    // keep word strings consistent with the (possibly edited) halves
    const lw = left.split(/\s+/);
    const rw = right.split(/\s+/);
    leftWords = leftWords.length === lw.length ? leftWords.map((w, i) => ({ ...w, word: lw[i] })) : undefined;
    rightWords = rightWords.length === rw.length ? rightWords.map((w, i) => ({ ...w, word: rw[i] })) : undefined;
  } else {
    boundary = seg.start + (seg.end - seg.start) * (pos / Math.max(1, text.length));
  }
  boundary = Math.round(Math.min(Math.max(boundary, seg.start + 0.05), seg.end - 0.05) * 1000) / 1000;
  const first: TranscriptSegment = { ...seg, text: left, end: boundary, words: leftWords };
  const second: TranscriptSegment = { ...seg, text: right, start: boundary, words: rightWords };
  segments.splice(index, 1, first, second);
  saveSegments(id, row, segments);
  return mutationResult(id, { kind: "splice", index, remove: 1, insert: [first, second] });
}

/** Merge speaker `from` into `into` across the whole transcript. */
export function mergeSpeakers(id: string, from: string, into: string): RecordingDetail | null {
  return mergeSpeakersPatch(id, from, into) ? getRecording(id) : null;
}

export function mergeSpeakersPatch(id: string, from: string, into: string): TranscriptMutationResult | null {
  const row = getRecordingRow(id);
  if (!row) return null;
  if (from === into) return mutationResult(id, { kind: "none" });
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
  return mutationResult(id, { kind: "speakerMerge", from, into });
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
