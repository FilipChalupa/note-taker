import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { RecordingStatus, TranscriptSegment, WorkerTaskStatus } from "@note-taker/shared";

export const recordings = sqliteTable("recordings", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  originalPath: text("original_path").notNull(),
  /** Normalized 16 kHz mono audio downloaded from the worker after completion */
  audioPath: text("audio_path"),
  language: text("language").notNull().default("cs"),
  /** Vocabulary hints for this recording (names, products, jargon) */
  hints: text("hints"),
  minSpeakers: integer("min_speakers"),
  maxSpeakers: integer("max_speakers"),

  status: text("status").$type<RecordingStatus>().notNull().default("QUEUED"),
  /** What the next/current worker task should do: full transcription or speakers only */
  taskKind: text("task_kind").$type<"transcribe" | "diarize">().notNull().default("transcribe"),
  workerTaskId: text("worker_task_id"),
  workerStatus: text("worker_status").$type<WorkerTaskStatus>(),
  progress: integer("progress").notNull().default(0),
  phase: text("phase"),
  error: text("error"),
  /** Non-fatal problem with a completed result (e.g. diarization failed) */
  warning: text("warning"),
  /** Number of dispatch attempts to the worker (for backoff when the worker is offline) */
  dispatchAttempts: integer("dispatch_attempts").notNull().default(0),

  durationSec: real("duration_sec"),
  detectedLanguage: text("detected_language"),
  speakerCount: integer("speaker_count"),
  speakers: text("speakers", { mode: "json" }).$type<string[]>().notNull().default([]),
  speakerNames: text("speaker_names", { mode: "json" }).$type<Record<string, string>>().notNull().default({}),
  segments: text("segments", { mode: "json" }).$type<TranscriptSegment[]>().notNull().default([]),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(),
  subscription: text("subscription", { mode: "json" }).$type<{ endpoint: string; keys: { p256dh: string; auth: string } }>().notNull(),
  locale: text("locale").notNull().default("en"),
  createdAt: text("created_at").notNull(),
});

export type RecordingRow = typeof recordings.$inferSelect;
export type NewRecordingRow = typeof recordings.$inferInsert;
