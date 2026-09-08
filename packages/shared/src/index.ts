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
export interface WorkerTaskStatusResponse {
  task_id: string;
  status: WorkerTaskStatus;
  /** 0-100 */
  progress: number;
  /** Human readable description of the current phase. */
  phase: string;
  queue_position: number | null;
  error: string | null;
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
  language: string;
  /** seconds */
  duration: number;
  model: string;
  diarized: boolean;
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
