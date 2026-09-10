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

export interface SpeakerStat {
  speaker: string;
  /** seconds of speech */
  seconds: number;
  /** 0..1 share of all speech */
  share: number;
  turns: number;
  words: number;
}

export interface TagCount {
  tag: string;
  count: number;
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
