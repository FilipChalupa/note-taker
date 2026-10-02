import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type APIRequestContext } from "@playwright/test";
import { WEB_URL } from "./constants";

/** Call once at the top of a spec file: the file then starts with an empty library. */
export function isolate(): void {
  test.beforeAll(async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: WEB_URL });
    const res = await ctx.post("/api/e2e/reset");
    await ctx.dispose();
    if (res.status() !== 204) throw new Error(`reset failed with ${res.status()}`);
  });
}

let tone: string | null = null;

/** 11 s test audio generated with ffmpeg (cached per run). */
export function toneFile(): string {
  if (tone && fs.existsSync(tone)) return tone;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-taker-audio-"));
  tone = path.join(dir, "tone.m4a");
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=11", "-c:a", "aac", tone]);
  return tone;
}

const talks: Record<string, string> = {};

/** 11 s of "talking": half-second bursts of a tone over room noise, so the worker has a speech level and a
 *  noise floor to measure. `noisy` puts the bursts only about 10 dB above the noise. */
export function talkFile(noisy = false): string {
  const key = noisy ? "noisy" : "clean";
  if (talks[key] && fs.existsSync(talks[key])) return talks[key];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "note-taker-audio-"));
  const file = path.join(dir, `talk-${key}.wav`);
  const [speech, noise] = noisy ? [0.05, 0.04] : [0.2, 0.002];
  const expr = `${speech}*sin(2*PI*220*t)*lt(mod(t\\,1)\\,0.5)+${noise}*(random(0)-0.5)`;
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `aevalsrc=${expr}:s=16000:d=11`, "-c:a", "pcm_s16le", file]);
  talks[key] = file;
  return file;
}

export async function uploadRecording(request: APIRequestContext, title: string, extra: Record<string, string> = {}, file: string = toneFile()) {
  const wav = file.endsWith(".wav");
  const res = await request.post("/api/recordings", {
    multipart: { file: { name: path.basename(file), mimeType: wav ? "audio/wav" : "audio/mp4", buffer: fs.readFileSync(file) }, title, language: "cs", ...extra },
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
