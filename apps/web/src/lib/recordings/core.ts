/** Row mapping and single-recording reads shared by the other recording modules. Server-side only. */
import fs from "node:fs";
import { eq } from "drizzle-orm";
import type { RecordingDetail, RecordingSummary, TranscriptMutationResult, TranscriptPatch } from "@note-taker/shared";
import { db, schema } from "@/lib/db";
import type { RecordingRow } from "@/lib/db/schema";

const { recordings } = schema;

export const now = () => new Date().toISOString();

export type SummaryRow = Pick<
  RecordingRow,
  | "id"
  | "title"
  | "originalFilename"
  | "language"
  | "detectedLanguage"
  | "status"
  | "workerStatus"
  | "progress"
  | "phase"
  | "durationSec"
  | "speakerCount"
  | "error"
  | "warning"
  | "tags"
  | "favorite"
  | "archived"
  | "ownerTokenId"
  | "createdAt"
  | "updatedAt"
>;

export function toSummary(r: SummaryRow): RecordingSummary {
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

/** Detail without the (potentially multi-megabyte) segment list. */
function toDetailHead(r: RecordingRow): Omit<RecordingDetail, "segments"> {
  const hasAudio = Boolean(r.audioPath && fs.existsSync(r.audioPath)) || fs.existsSync(r.originalPath);
  return {
    ...toSummary(r),
    hints: r.hints ?? null,
    notes: r.notes ?? null,
    speakerSuggestions: r.speakerSuggestions ?? {},
    speakersWithEmbedding: Object.keys(r.speakerEmbeddings ?? {}),
    speakerNames: r.speakerNames ?? {},
    speakers: r.speakers ?? [],
    audioUrl: hasAudio ? `/api/recordings/${r.id}/audio` : null,
  };
}

/** Result of a transcript mutation: light head + a patch the client can apply locally. */
export function mutationResult(id: string, patch: TranscriptPatch): TranscriptMutationResult | null {
  const row = getRecordingRow(id);
  return row ? { recording: toDetailHead(row), patch } : null;
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

export function getRecording(id: string): RecordingDetail | null {
  const row = db.select().from(recordings).where(eq(recordings.id, id)).get();
  return row ? toDetail(row) : null;
}

export function getRecordingRow(id: string): RecordingRow | null {
  return db.select().from(recordings).where(eq(recordings.id, id)).get() ?? null;
}

export function recordingHead(id: string): Omit<RecordingDetail, "segments"> | null {
  const row = getRecordingRow(id);
  return row ? toDetailHead(row) : null;
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
