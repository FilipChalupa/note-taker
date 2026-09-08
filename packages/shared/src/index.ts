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
  createdAt: string;
  updatedAt: string;
}

export interface RecordingDetail extends RecordingSummary {
  /** Map of raw speaker id (SPEAKER_00) to user-provided display name. */
  speakerNames: Record<string, string>;
  speakers: string[];
  segments: TranscriptSegment[];
  audioUrl: string | null;
}

export type ExportFormat = "md" | "txt" | "srt" | "vtt";

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
