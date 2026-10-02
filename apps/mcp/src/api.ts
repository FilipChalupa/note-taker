/** Thin typed client for the Note Taker REST API (/api/v1). */
import { openAsBlob } from "node:fs";

export type Scope = "submit" | "read" | "write" | "admin";

export interface Identity {
  name: string;
  scopes: Scope[];
  tagFilter: string | null;
  limits: { requestsPerHour: number; submitsPerHour: number; maxUploadBytes: number };
  defaultLanguage: string;
  version: string;
}

export interface RecordingSummary {
  id: string;
  title: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  phase: string | null;
  language: string;
  durationSeconds: number | null;
  speakerCount: number | null;
  tags: string[];
  error: string | null;
  warning: string | null;
  createdAt: string;
  updatedAt: string;
  notes?: string | null;
  speakers?: Array<{ id: string; name: string; named: boolean }>;
  segmentCount?: number;
  /** Levels of the original upload (dBFS) and what they mean for the transcript: "noisy", "quiet", "clipping". */
  audioQuality?: { speechDb: number; noiseDb: number; snrDb: number; clippedShare: number; issues: string[] } | null;
}

export interface TranscriptJson {
  id: string;
  language: string;
  durationSeconds: number | null;
  speakers: Array<{ id: string; name: string | null }>;
  segments: Array<{ index: number; start: number; end: number; speaker: string; speakerName: string; text: string; words?: Array<{ word: string; start: number | null; end: number | null }> }>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NoteTakerApi {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...(init.headers as Record<string, string> | undefined) },
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new ApiError(`Note Taker is unreachable at ${this.baseUrl}: ${(err as Error).message}`, 0, "UNREACHABLE");
    }
    if (res.status === 204) return undefined as T;
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = (body.error ?? {}) as { code?: string };
      const code = error.code ?? String(body.error ?? `HTTP_${res.status}`);
      throw new ApiError(`${code} (HTTP ${res.status})`, res.status, code, error as Record<string, unknown>);
    }
    return body as T;
  }

  me(): Promise<Identity> {
    return this.request<Identity>("/api/v1/me");
  }

  listRecordings(params: { limit?: number; page?: number; tag?: string; status?: string; sort?: string; archived?: boolean } = {}): Promise<{ items: RecordingSummary[]; total: number; page: number; limit: number }> {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) q.set(k, String(v));
    return this.request(`/api/v1/recordings?${q}`);
  }

  getRecording(id: string): Promise<RecordingSummary> {
    return this.request(`/api/v1/recordings/${id}`);
  }

  async submit(input: {
    path?: string;
    contentBase64?: string;
    filename?: string;
    title?: string;
    language?: string;
    tags?: string;
    hints?: string;
    notes?: string;
    minSpeakers?: number;
    maxSpeakers?: number;
  }): Promise<RecordingSummary> {
    const form = new FormData();
    if (input.path) {
      const blob = await openAsBlob(input.path);
      form.append("file", blob, input.filename ?? input.path.split("/").pop() ?? "recording");
    } else if (input.contentBase64) {
      form.append("file", new Blob([Buffer.from(input.contentBase64, "base64")]), input.filename ?? "recording.webm");
    } else {
      throw new ApiError("Provide either path or content_base64", 400, "MISSING_AUDIO");
    }
    for (const [key, value] of [
      ["title", input.title],
      ["language", input.language],
      ["tags", input.tags],
      ["hints", input.hints],
      ["notes", input.notes],
      ["minSpeakers", input.minSpeakers],
      ["maxSpeakers", input.maxSpeakers],
    ] as const) {
      if (value !== undefined && value !== null && value !== "") form.append(key, String(value));
    }
    // large uploads over a slow link
    return this.request("/api/v1/recordings", { method: "POST", body: form }, 30 * 60_000);
  }

  transcriptJson(id: string, words: boolean): Promise<TranscriptJson> {
    return this.request(`/api/v1/recordings/${id}/transcript?format=json&words=${words}`);
  }

  transcriptText(id: string, format: "md" | "txt" | "srt" | "vtt"): Promise<{ id: string; format: string; content: string }> {
    return this.request(`/api/v1/recordings/${id}/transcript?format=${format}`);
  }

  speakers(id: string): Promise<{ speakers: Array<{ id: string; name: string | null; suggestion: { name: string; score: number } | null }>; stats: Array<{ speaker: string; name: string; seconds: number; share: number; turns: number; words: number }> }> {
    return this.request(`/api/v1/recordings/${id}/speakers`);
  }

  updateSpeakers(id: string, body: { names?: Record<string, string>; merge?: { from: string; into: string } }) {
    return this.request<{ speakers: Array<{ id: string; name: string | null }> }>(`/api/v1/recordings/${id}/speakers`, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  }

  updateRecording(id: string, body: Record<string, unknown>): Promise<RecordingSummary> {
    return this.request(`/api/v1/recordings/${id}`, { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
  }

  editSegments(id: string, edits: Array<{ index: number; text?: string; speaker?: string; start?: number; end?: number }>) {
    return this.request<{ ok: boolean; segmentCount: number }>(`/api/v1/recordings/${id}/segments`, { method: "PATCH", body: JSON.stringify({ edits }), headers: { "Content-Type": "application/json" } });
  }

  deleteRecording(id: string): Promise<void> {
    return this.request(`/api/v1/recordings/${id}`, { method: "DELETE" });
  }

  search(query: string, limit: number) {
    return this.request<{ query: string; hits: Array<{ id: string; title: string; createdAt: string; durationSeconds: number | null; snippet: string }> }>(`/api/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  tags() {
    return this.request<{ tags: Array<{ tag: string; count: number }> }>("/api/v1/tags");
  }

  status() {
    return this.request<Record<string, unknown>>("/api/v1/status");
  }

  audioUrl(id: string, ttlSeconds: number) {
    return this.request<{ url: string; expiresInSeconds: number }>(`/api/v1/recordings/${id}/audio?sign=true&ttl=${ttlSeconds}`);
  }

  absolute(pathname: string): string {
    return `${this.baseUrl}${pathname}`;
  }
}
