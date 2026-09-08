/**
 * Thin HTTP client for apps/worker. Server-side only.
 */
import fs from "node:fs";
import { openAsBlob } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type {
  TranscribeAccepted,
  TranscribeParams,
  WorkerHealth,
  WorkerTaskResult,
  WorkerTaskStatusResponse,
} from "@note-taker/shared";
import { config } from "@/lib/config";

export class WorkerError extends Error {
  constructor(message: string, public readonly status?: number, public readonly retryable = true) {
    super(message);
    this.name = "WorkerError";
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return config.workerApiKey ? { "X-API-Key": config.workerApiKey, ...extra } : extra;
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const url = `${config.workerApiUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: headers((init.headers as Record<string, string>) ?? {}),
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (err) {
    throw new WorkerError(`Worker unreachable (${config.workerApiUrl}): ${(err as Error).message}`);
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (body?.detail) detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* ignore */
    }
    // 404 (unknown task) and 401 (bad key) are not going to fix themselves by retrying
    throw new WorkerError(`Worker responded ${res.status}: ${detail}`, res.status, res.status >= 500);
  }
  return (await res.json()) as T;
}

export const workerClient = {
  health: () => request<WorkerHealth>("/health", {}, 5_000),

  async submit(filePath: string, filename: string, params: TranscribeParams): Promise<TranscribeAccepted> {
    const form = new FormData();
    form.append("file", await openAsBlob(filePath), filename);
    if (params.language) form.append("language", params.language);
    if (params.min_speakers) form.append("min_speakers", String(params.min_speakers));
    if (params.max_speakers) form.append("max_speakers", String(params.max_speakers));
    // Large uploads over slow links: give it 10 minutes
    return request<TranscribeAccepted>("/transcribe", { method: "POST", body: form }, 10 * 60_000);
  },

  status: (taskId: string) => request<WorkerTaskStatusResponse>(`/tasks/${taskId}/status`),

  async result(taskId: string): Promise<WorkerTaskResult | null> {
    const url = `${config.workerApiUrl}/tasks/${taskId}/result`;
    const res = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(60_000) });
    if (res.status === 202) return null; // not finished yet
    if (!res.ok) throw new WorkerError(`Worker responded ${res.status} for result`, res.status, res.status >= 500);
    return (await res.json()) as WorkerTaskResult;
  },

  async downloadAudio(audioUrl: string, destPath: string): Promise<void> {
    const url = audioUrl.startsWith("http") ? audioUrl : `${config.workerApiUrl}${audioUrl}`;
    const res = await fetch(url, { headers: headers(), cache: "no-store", signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok || !res.body) throw new WorkerError(`Audio download failed: ${res.status}`, res.status);
    const tmp = `${destPath}.part`;
    await pipeline(Readable.fromWeb(res.body as never), fs.createWriteStream(tmp));
    fs.renameSync(tmp, destPath);
  },

  async deleteTask(taskId: string): Promise<void> {
    try {
      await request<void>(`/tasks/${taskId}`, { method: "DELETE" });
    } catch (err) {
      // Best effort: the worker prunes old tasks itself
      if (!(err instanceof WorkerError)) throw err;
    }
  },
};
