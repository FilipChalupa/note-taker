import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { APIRequestContext } from "@playwright/test";

let tone: string | null = null;

/** 11 s test audio generated with ffmpeg (cached per run). */
export function toneFile(): string {
  if (tone && fs.existsSync(tone)) return tone;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-taker-audio-"));
  tone = path.join(dir, "tone.m4a");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=11", "-c:a", "aac", tone]);
  return tone;
}

export async function uploadRecording(request: APIRequestContext, title: string, extra: Record<string, string> = {}) {
  const res = await request.post("/api/recordings", {
    multipart: { file: { name: "tone.m4a", mimeType: "audio/mp4", buffer: fs.readFileSync(toneFile()) }, title, language: "cs", ...extra },
  });
  if (!res.ok()) throw new Error(`upload failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string };
}

export async function waitForStatus(request: APIRequestContext, id: string, wanted: string[] = ["COMPLETED", "FAILED"], timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rec = await (await request.get(`/api/recordings/${id}`)).json();
    if (wanted.includes(rec.status)) return rec;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`recording ${id} did not reach ${wanted.join("/")}`);
}

export async function completedRecording(request: APIRequestContext, title: string) {
  const { id } = await uploadRecording(request, title);
  return waitForStatus(request, id, ["COMPLETED"]);
}
