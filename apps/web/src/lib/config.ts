import path from "node:path";

function num(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const config = {
  // turbopackIgnore: a dynamic path would otherwise make Next trace the whole project into the standalone build
  dataDir: path.resolve(/* turbopackIgnore: true */ process.env.DATA_DIR ?? "./data"),
  workerApiUrl: (process.env.WORKER_API_URL ?? "http://localhost:8000").replace(/\/+$/, ""),
  workerApiKey: process.env.WORKER_API_KEY || undefined,
  pollIntervalMs: num("WORKER_POLL_INTERVAL_MS", 3000),
  defaultLanguage: process.env.DEFAULT_LANGUAGE ?? "cs",
  maxUploadBytes: num("MAX_UPLOAD_MB", 2048) * 1024 * 1024,
  /** Watch folder: audio files dropped here are imported automatically (empty = disabled). */
  importDir: process.env.IMPORT_DIR ? path.resolve(process.env.IMPORT_DIR) : null,
  /** Language assigned to imported files. */
  importLanguage: process.env.IMPORT_LANGUAGE ?? process.env.DEFAULT_LANGUAGE ?? "cs",
  /** Optional public intake service to pull uploads from (the web app connects out, nothing connects in). */
  intakeUrl: (process.env.INTAKE_URL ?? "").replace(/\/+$/, "") || null,
  intakeToken: process.env.INTAKE_TOKEN || null,
  intakePollMs: num("INTAKE_POLL_SECONDS", 30) * 1000,
  intakeTags: (process.env.INTAKE_TAGS ?? "intake").split(",").map((t) => t.trim()).filter(Boolean),
  /** Per-token limits for /api/v1 (agents). */
  apiRequestsPerHour: num("API_RATE_LIMIT_PER_HOUR", 600),
  apiSubmitsPerHour: num("API_SUBMIT_LIMIT_PER_HOUR", 60),
  auditRetentionDays: num("AUDIT_RETENTION_DAYS", 30),
} as const;

export const SUPPORTED_MEDIA = /\.(mp3|mpga|m4a|m4b|wav|aac|ogg|oga|opus|flac|wma|aiff?|mka|webm|mp4|m4v|mov|mkv|avi|mpe?g|ts|3gp|amr)$/i;

export function recordingDir(id: string): string {
  return path.join(config.dataDir, "recordings", id);
}
