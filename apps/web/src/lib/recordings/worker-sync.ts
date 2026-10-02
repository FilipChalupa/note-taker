/** Hand-off to the GPU worker and syncing results back: dispatch, polling, retry, speaker recomputation. Server-side only. */
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import type { RecordingDetail, TranscriptSegment } from "@note-taker/shared";
import { config, recordingDir } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { buildInitialPrompt } from "@/lib/settings";
import { notifyAll, recordingNotification } from "@/lib/push";
import { suggestSpeakers } from "@/lib/voices";
import { workerClient, WorkerError } from "@/lib/worker-client";
import { now, getRecording, getRecordingRow } from "./core";
import { indexRecording } from "./search";

const { recordings } = schema;

export async function retryRecording(id: string): Promise<RecordingDetail | null> {
  const row = getRecordingRow(id);
  if (!row) return null;
  if (!fs.existsSync(row.originalPath)) {
    db.update(recordings)
      .set({ status: "FAILED", error: "ORIGINAL_FILE_MISSING", updatedAt: now() })
      .where(eq(recordings.id, id))
      .run();
    return getRecording(id);
  }
  db.update(recordings)
    .set({
      status: "QUEUED",
      taskKind: "transcribe",
      workerTaskId: null,
      workerStatus: null,
      progress: 0,
      phase: "QUEUED",
      error: null,
      warning: null,
      dispatchAttempts: 0,
      // speaker ids are reassigned by a new diarization run, old names would not match
      speakerNames: row.status === "COMPLETED" ? {} : row.speakerNames,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  indexRecording(id);
  void dispatch(id).catch(() => {});
  return getRecording(id);
}

/**
 * Queue a speakers-only re-run. Keeps the transcript; the poller hands audio + segments to the
 * worker (task kind "diarize") as soon as it is reachable.
 */
export async function rediarizeRecording(
  id: string,
  opts: { minSpeakers?: number; maxSpeakers?: number },
): Promise<{ recording: RecordingDetail } | { error: string; status: number }> {
  const row = getRecordingRow(id);
  if (!row) return { error: "NOT_FOUND", status: 404 };
  if (row.status !== "COMPLETED") return { error: "NOT_FINISHED", status: 409 };
  const audio = row.audioPath && fs.existsSync(row.audioPath) ? row.audioPath : fs.existsSync(row.originalPath) ? row.originalPath : null;
  if (!audio) return { error: "AUDIO_UNAVAILABLE", status: 409 };
  if (!row.segments?.length) return { error: "NO_TRANSCRIPT", status: 409 };

  db.update(recordings)
    .set({
      status: "QUEUED",
      taskKind: "diarize",
      workerTaskId: null,
      workerStatus: null,
      progress: 0,
      phase: "QUEUED",
      error: null,
      warning: null,
      dispatchAttempts: 0,
      minSpeakers: opts.minSpeakers ?? null,
      maxSpeakers: opts.maxSpeakers ?? null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();
  void dispatch(id).catch(() => {});
  return { recording: getRecording(id)! };
}

/** Upload the original file to the worker and store the task id. Safe to call repeatedly. */
export async function dispatch(id: string): Promise<void> {
  const row = getRecordingRow(id);
  if (!row || row.workerTaskId || row.status !== "QUEUED") return;
  try {
    let accepted;
    if (row.taskKind === "diarize") {
      const audio = row.audioPath && fs.existsSync(row.audioPath) ? row.audioPath : row.originalPath;
      accepted = await workerClient.submitDiarize(audio, path.basename(audio), row.segments, {
        language: row.detectedLanguage ?? undefined,
        min_speakers: row.minSpeakers ?? undefined,
        max_speakers: row.maxSpeakers ?? undefined,
      });
    } else {
      accepted = await workerClient.submit(row.originalPath, row.originalFilename, {
        language: row.language === "auto" ? undefined : row.language,
        min_speakers: row.minSpeakers ?? undefined,
        max_speakers: row.maxSpeakers ?? undefined,
        initial_prompt: buildInitialPrompt(row.hints),
      });
    }
    db.update(recordings)
      .set({
        workerTaskId: accepted.task_id,
        workerStatus: accepted.status,
        phase: accepted.queue_position > 0 ? `WORKER_QUEUE:${accepted.queue_position}` : "QUEUED",
        error: null,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const retryable = !(err instanceof WorkerError) || err.retryable;
    if (!retryable && row.taskKind === "diarize") {
      // Speakers-only re-run rejected (e.g. diarization disabled): keep the existing transcript
      db.update(recordings)
        .set({ status: "COMPLETED", taskKind: "transcribe", phase: "COMPLETED", warning: `REDIARIZE_FAILED:${msg}`, updatedAt: now() })
        .where(eq(recordings.id, id))
        .run();
      return;
    }
    db.update(recordings)
      .set({
        status: retryable ? "QUEUED" : "FAILED",
        phase: retryable ? "WAITING_FOR_WORKER" : "FAILED",
        error: msg,
        dispatchAttempts: row.dispatchAttempts + 1,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
  }
}

/** Pull status/result for one in-flight recording from the worker. */
export async function syncRecording(id: string): Promise<void> {
  const row = getRecordingRow(id);
  if (!row || row.status === "COMPLETED" || row.status === "FAILED") return;
  if (!row.workerTaskId) {
    await dispatch(id);
    return;
  }

  let status;
  try {
    status = await workerClient.status(row.workerTaskId);
  } catch (err) {
    if (err instanceof WorkerError && err.status === 404) {
      // Worker lost the task (restart / TTL) - resubmit from the original file
      db.update(recordings)
        .set({ workerTaskId: null, workerStatus: null, status: "QUEUED", progress: 0, updatedAt: now() })
        .where(eq(recordings.id, id))
        .run();
      await dispatch(id);
      return;
    }
    db.update(recordings)
      .set({ phase: "WORKER_UNREACHABLE", error: (err as Error).message, updatedAt: now() })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  if (status.status === "FAILED" && row.taskKind === "diarize") {
    // Keep the existing transcript, just report that speakers could not be recomputed
    db.update(recordings)
      .set({
        status: "COMPLETED",
        taskKind: "transcribe",
        workerTaskId: null,
        workerStatus: null,
        progress: 100,
        phase: "COMPLETED",
        warning: `REDIARIZE_FAILED:${status.error ?? "WORKER_UNKNOWN_ERROR"}`,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  if (status.status === "FAILED") {
    db.update(recordings)
      .set({
        status: "FAILED",
        workerStatus: status.status,
        phase: "FAILED",
        progress: status.progress,
        error: status.error ?? "WORKER_UNKNOWN_ERROR",
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
    void notifyAll(recordingNotification({ id, title: row.title, status: "FAILED" })).catch(() => {});
    return;
  }

  if (status.status !== "COMPLETED") {
    const queued = status.status === "QUEUED";
    const phase =
      queued && status.queue_position && status.queue_position > 0
        ? `WORKER_QUEUE:${status.queue_position}`
        : status.status;
    db.update(recordings)
      .set({
        status: queued ? "QUEUED" : "PROCESSING",
        workerStatus: status.status,
        progress: status.progress,
        phase,
        error: null,
        updatedAt: now(),
      })
      .where(eq(recordings.id, id))
      .run();
    return;
  }

  // COMPLETED -> fetch result + normalized audio
  const result = await workerClient.result(row.workerTaskId);
  if (!result) return;

  const diarizeOnly = result.kind === "diarize";
  const audioExt = result.audio_mime === "audio/wav" ? "wav" : "mp3";
  const audioPath = diarizeOnly && row.audioPath ? row.audioPath : path.join(recordingDir(id), `audio.${audioExt}`);
  if (!diarizeOnly) {
    try {
      await workerClient.downloadAudio(result.audio_url, audioPath);
    } catch (err) {
      // Not fatal: we can still play the original upload
      console.warn(`[recordings] audio download failed for ${id}:`, (err as Error).message);
    }
  }

  const segments: TranscriptSegment[] = result.segments.map((s) => ({
    start: s.start,
    end: s.end,
    speaker: s.speaker,
    text: s.text,
    words: s.words?.map((w) => ({ word: w.word, start: w.start, end: w.end, speaker: w.speaker })),
  }));

  db.update(recordings)
    .set({
      status: "COMPLETED",
      taskKind: "transcribe",
      workerStatus: "COMPLETED",
      progress: 100,
      phase: "COMPLETED",
      error: null,
      warning: result.diarized ? null : `DIARIZATION_FAILED:${result.diarization_error ?? "unknown"}`,
      durationSec: diarizeOnly ? row.durationSec : result.duration,
      detectedLanguage: diarizeOnly ? row.detectedLanguage : result.language,
      speakerCount: result.speakers.filter((s) => s !== "UNKNOWN").length,
      speakers: result.speakers,
      speakerNames: {},
      speakerEmbeddings: result.speaker_embeddings ?? null,
      speakerSuggestions: suggestSpeakers(result.speaker_embeddings),
      segments,
      // a speakers-only re-run has no original upload to measure: the earlier report stays
      audioQuality: diarizeOnly ? row.audioQuality : (result.audio_quality ?? null),
      audioPath: fs.existsSync(audioPath) ? audioPath : null,
      updatedAt: now(),
    })
    .where(eq(recordings.id, id))
    .run();

  indexRecording(id);
  void notifyAll(
    recordingNotification({ id, title: row.title, status: "COMPLETED", speakerCount: result.speakers.filter((s) => s !== "UNKNOWN").length }),
  ).catch(() => {});

  // Free space on the worker; it keeps its own copy only as a TTL cache.
  void workerClient.deleteTask(row.workerTaskId).catch(() => {});
}

/** Sync every recording that is still in flight. Called by the poller. */
export async function syncAll(): Promise<void> {
  const inflight = db
    .select({ id: recordings.id, workerTaskId: recordings.workerTaskId, dispatchAttempts: recordings.dispatchAttempts, updatedAt: recordings.updatedAt })
    .from(recordings)
    .where(and(inArray(recordings.status, ["QUEUED", "PROCESSING"])))
    .all();

  for (const r of inflight) {
    // Exponential backoff for dispatch when the worker is offline (max ~2 min between tries)
    if (!r.workerTaskId && r.dispatchAttempts > 0) {
      const wait = Math.min(120_000, config.pollIntervalMs * 2 ** Math.min(r.dispatchAttempts, 6));
      if (Date.now() - new Date(r.updatedAt).getTime() < wait) continue;
    }
    try {
      await syncRecording(r.id);
    } catch (err) {
      console.error(`[recordings] sync failed for ${r.id}:`, (err as Error).message);
    }
  }
}
