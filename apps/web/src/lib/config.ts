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
} as const;

export const SUPPORTED_MEDIA = /\.(mp3|mpga|m4a|m4b|wav|aac|ogg|oga|opus|flac|wma|aiff?|mka|webm|mp4|m4v|mov|mkv|avi|mpe?g|ts|3gp|amr)$/i;

export function recordingDir(id: string): string {
  return path.join(config.dataDir, "recordings", id);
}
