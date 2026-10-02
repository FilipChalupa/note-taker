export * from "./speaker-stats";
export * from "./media";
export * from "./input-monitor";
export * from "./audio-quality";
import type { AudioQuality, AudioQualityIssue } from "./audio-quality";

/**
 * Shared API contracts between `apps/worker` (Python/FastAPI) and `apps/web` (Next.js).
 * Keep in sync with `apps/worker/worker/models.py`.
 */

/** Lifecycle of a transcription task inside the worker. */
export type WorkerTaskStatus =
  | "QUEUED"
  | "CONVERTING"
  | "TRANSCRIBING"
  | "DIARIZING"
  | "COMPLETED"
  | "FAILED";

export const TERMINAL_STATUSES: readonly WorkerTaskStatus[] = ["COMPLETED", "FAILED"];

export function isTerminalStatus(status: WorkerTaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Parameters accepted by `POST /transcribe` (besides the multipart `file`). */
export interface TranscribeParams {
  /** ISO 639-1 language code, e.g. `cs`. Omit for auto-detect. */
  language?: string;
  min_speakers?: number;
  max_speakers?: number;
  /** Glossary / vocabulary hints handed to Whisper as initial prompt. */
  initial_prompt?: string;
}

/** Response of `POST /transcribe`. */
export interface TranscribeAccepted {
  task_id: string;
  status: WorkerTaskStatus;
  /** Position in the queue (0 = currently processing). */
  queue_position: number;
}

/** Response of `GET /tasks/{id}/status`. */
export type WorkerTaskKind = "transcribe" | "diarize";

export interface WorkerTaskStatusResponse {
  task_id: string;
  kind: WorkerTaskKind;
  /** Original upload filename as seen by the worker. */
  filename: string | null;
  status: WorkerTaskStatus;
  /** 0-100 */
  progress: number;
  /** Human readable description of the current phase. */
  phase: string;
  queue_position: number | null;
  error: string | null;
  /** Audio length in seconds, known right after upload. */
  duration: number | null;
  /** Estimated seconds until COMPLETED (includes queue wait for queued tasks). */
  eta_seconds: number | null;
  expected_finish_at: string | null;
  /** Expected processing speed of the current phase as a multiple of real time. */
  speed_rtf: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TranscriptWord {
  word: string;
  start?: number;
  end?: number;
  speaker?: string;
  score?: number;
}

export interface TranscriptSegment {
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  /** e.g. `SPEAKER_00`; `UNKNOWN` when diarization could not assign one. */
  speaker: string;
  text: string;
  words?: TranscriptWord[];
}

/** Response of `GET /tasks/{id}/result`. */
export interface WorkerTaskResult {
  task_id: string;
  kind: WorkerTaskKind;
  language: string;
  /** seconds */
  duration: number;
  model: string;
  diarized: boolean;
  /** Why speakers were not identified; null when diarization succeeded. */
  diarization_error: string | null;
  /** Distinct speaker ids in order of first appearance. */
  speakers: string[];
  segments: TranscriptSegment[];
  /** Per-speaker voice embeddings from the diarization model (null when diarization did not run). */
  speaker_embeddings: Record<string, number[]> | null;
  /** Levels of the original upload; null when not measurable or for a speakers-only re-run, absent on older workers. */
  audio_quality?: AudioQuality | null;
  /** Relative URL (on the worker) of the normalized 16 kHz mono audio. */
  audio_url: string;
  audio_mime: string;
}

/** Response of `GET /health`. */
export interface WorkerHealth {
  ok: boolean;
  version: string;
  model: string;
  compute_type: string;
  device: string;
  model_loaded: boolean;
  diarization_enabled: boolean;
  /** Last diarization failure on the worker, if any. */
  diarization_error: string | null;
  cuda: {
    available: boolean;
    device_name: string | null;
    vram_total_mb: number | null;
    vram_free_mb: number | null;
    vram_used_mb: number | null;
    /** Live telemetry from nvidia-smi (whole GPU). */
    utilization_pct: number | null;
    temperature_c: number | null;
    power_w: number | null;
    memory_used_mb: number | null;
  };
  queue: {
    pending: number;
    current_task_id: string | null;
  };
}

// ---------------------------------------------------------------------------
// Web app (apps/web) domain types exposed to the browser
// ---------------------------------------------------------------------------

export type RecordingStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";

export interface RecordingSummary {
  id: string;
  title: string;
  originalFilename: string;
  language: string;
  status: RecordingStatus;
  workerStatus: WorkerTaskStatus | null;
  progress: number;
  phase: string | null;
  durationSec: number | null;
  speakerCount: number | null;
  error: string | null;
  /** Non-fatal problem with the result, e.g. "DIARIZATION_FAILED:<reason>". */
  warning: string | null;
  /** What the worker's sound report holds against the recording; empty when fine or not measured. */
  audioIssues: AudioQualityIssue[];
  /** Free-form labels: project, customer, meeting type… */
  tags: string[];
  favorite: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecordingDetail extends RecordingSummary {
  /** Per-recording vocabulary hints (names, products...) given at upload. */
  hints: string | null;
  /** Free-text notes about the meeting (Markdown allowed). */
  notes: string | null;
  /** Known-voice suggestions per raw speaker id, from voice embeddings. */
  speakerSuggestions: Record<string, VoiceSuggestion>;
  /** Raw speaker ids that have a voice embedding (can be learned as a known voice). */
  speakersWithEmbedding: string[];
  /** Map of raw speaker id (SPEAKER_00) to user-provided display name. */
  speakerNames: Record<string, string>;
  speakers: string[];
  segments: TranscriptSegment[];
  audioUrl: string | null;
  /** Levels of the original upload as measured by the worker; null for older or unmeasurable recordings. */
  audioQuality: AudioQuality | null;
}

export type ExportFormat = "md" | "txt" | "srt" | "vtt";

/** One transcript edit: change text, speaker and/or times of the segment at `index`. */
export interface SegmentEdit {
  index: number;
  text?: string;
  speaker?: string;
  /** seconds */
  start?: number;
  end?: number;
}

/** Change description returned by transcript mutations when `?light=1` is passed (no full segment list). */
export type TranscriptPatch =
  | { kind: "edits"; segments: Record<number, TranscriptSegment> }
  | { kind: "splice"; index: number; remove: number; insert: TranscriptSegment[] }
  | { kind: "speakerMerge"; from: string; into: string }
  | { kind: "none" };

export interface TranscriptMutationResult {
  recording: Omit<RecordingDetail, "segments">;
  patch: TranscriptPatch;
}

export interface SearchHit {
  id: string;
  title: string;
  createdAt: string;
  durationSec: number | null;
  /** Snippet with matches wrapped in <mark>…</mark> (HTML-escaped otherwise). */
  snippet: string;
}

export interface StorageInfo {
  dataDir: string;
  recordings: number;
  /** bytes */
  originalsBytes: number;
  audioBytes: number;
  databaseBytes: number;
  totalBytes: number;
  /** Free / total space of the volume holding DATA_DIR (null when unavailable). */
  volumeFreeBytes: number | null;
  volumeTotalBytes: number | null;
  importDir: ImportDirInfo;
}

export interface VoiceSuggestion {
  voiceId: string;
  name: string;
  /** cosine similarity 0..1 */
  score: number;
}

/** A known voice learned from renamed speakers. */
export interface Voice {
  id: string;
  name: string;
  samples: number;
  createdAt: string;
  updatedAt: string;
}

export type RecordingSort = "newest" | "oldest" | "title" | "longest" | "shortest";
export type RecordingView = "active" | "favorites" | "archived" | "all";

export interface RecordingListQuery {
  tag?: string;
  /** Restrict to recordings created by this API token (used for submit-only tokens). */
  ownerTokenId?: string;
  view?: RecordingView;
  sort?: RecordingSort;
  page?: number;
  pageSize?: number;
}

export interface RecordingPage {
  items: RecordingSummary[];
  total: number;
  page: number;
  pageSize: number;
}

export type BulkAction = "delete" | "addTag" | "removeTag" | "archive" | "unarchive" | "favorite" | "unfavorite";


/** GET /metrics on the worker. */
export interface WorkerMetrics {
  totals: { completed: number; failed: number; audio_seconds: number; processing_seconds: number; diarize_only: number };
  /** audio seconds per processing second over everything ever processed */
  speed_rtf: number | null;
  failure_rate: number;
  days: Array<{ date: string; completed: number; failed: number; audio_seconds: number; processing_seconds: number }>;
  phase_rtf: Record<string, number>;
}

/**
 * API token scopes.
 *  submit - create recordings and read back only its own
 *  read   - read every recording, transcript, speaker and tag
 *  write  - edit transcripts, speakers, tags and notes
 *  admin  - delete recordings and manage tokens
 */
export type ApiTokenScope = "submit" | "read" | "write" | "admin";

export interface ApiTokenInfo {
  id: string;
  name: string;
  /** First characters of the secret, for recognising a token in the list. */
  prefix: string;
  scopes: ApiTokenScope[];
  /** When set, the token only sees recordings carrying this tag. */
  tagFilter: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  requests: number;
}

/** Returned once, when the token is created. */
export interface ApiTokenCreated {
  token: ApiTokenInfo;
  secret: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  tokenName: string | null;
  action: string;
  recordingId: string | null;
  status: number;
  detail: string | null;
}

/** GET /api/v1/me */
export interface ApiIdentity {
  name: string;
  scopes: ApiTokenScope[];
  tagFilter: string | null;
  expiresAt: string | null;
  limits: { requestsPerHour: number; submitsPerHour: number; maxUploadBytes: number };
  defaultLanguage: string;
  version: string;
}

export interface TagCount {
  tag: string;
  count: number;
}

/** State of the pull from the public intake service. */
export interface IntakeStatus {
  enabled: boolean;
  url: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  /** Items the intake reported as ready at the last check. */
  pending: number | null;
  collected: number;
  running: boolean;
}

export interface ImportDirInfo {
  path: string | null;
  enabled: boolean;
  /** Files currently waiting in the folder. */
  pending: number;
  imported: number;
}

export interface AppSettings {
  /** Global glossary of names and terms, one per line or comma-separated. */
  glossary: string;
}

/** One entry of the worker queue as shown by the web app (`GET /api/worker/queue`). */
export interface QueueItem {
  taskId: string | null;
  kind: WorkerTaskKind;
  status: WorkerTaskStatus;
  progress: number;
  phase: string | null;
  /** 0 = processing now, 1.. = waiting; null = not yet handed to the worker */
  queuePosition: number | null;
  filename: string | null;
  createdAt: string;
  startedAt: string | null;
  durationSec: number | null;
  etaSeconds: number | null;
  expectedFinishAt: string | null;
  speedRtf: number | null;
  /** Local recording this task belongs to (null if submitted by another client). */
  recording: { id: string; title: string } | null;
}

export interface QueueResponse {
  reachable: boolean;
  error?: string;
  /** Task currently on the GPU. */
  current: QueueItem | null;
  /** Tasks waiting inside the worker, in order. */
  pending: QueueItem[];
  /** Local recordings not yet accepted by the worker (worker offline / retrying). */
  waiting: QueueItem[];
}
