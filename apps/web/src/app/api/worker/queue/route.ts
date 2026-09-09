import { NextResponse } from "next/server";
import { inArray } from "drizzle-orm";
import type { QueueItem, QueueResponse, WorkerTaskStatusResponse } from "@note-taker/shared";
import { db, schema } from "@/lib/db";
import { workerClient } from "@/lib/worker-client";
import { ensurePollerStarted } from "@/lib/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensurePollerStarted();
  const { recordings } = schema;

  // Local recordings that have not been accepted by the worker yet
  const waitingRows = db
    .select({ id: recordings.id, title: recordings.title, filename: recordings.originalFilename, phase: recordings.phase, createdAt: recordings.createdAt, durationSec: recordings.durationSec, taskKind: recordings.taskKind })
    .from(recordings)
    .where(inArray(recordings.status, ["QUEUED"]))
    .all();

  let tasks: WorkerTaskStatusResponse[] = [];
  let reachable = true;
  let error: string | undefined;
  try {
    tasks = await workerClient.listTasks(true);
  } catch (err) {
    reachable = false;
    error = (err as Error).message;
  }

  const taskIds = tasks.map((t) => t.task_id);
  const linked = taskIds.length
    ? db
        .select({ id: recordings.id, title: recordings.title, workerTaskId: recordings.workerTaskId })
        .from(recordings)
        .where(inArray(recordings.workerTaskId, taskIds))
        .all()
    : [];
  const byTask = new Map(linked.map((r) => [r.workerTaskId!, { id: r.id, title: r.title }]));
  const linkedIds = new Set(linked.map((r) => r.id));

  const toItem = (t: WorkerTaskStatusResponse): QueueItem => ({
    taskId: t.task_id,
    kind: t.kind ?? "transcribe",
    status: t.status,
    progress: t.progress,
    phase: t.queue_position && t.queue_position > 0 ? `WORKER_QUEUE:${t.queue_position}` : t.status,
    queuePosition: t.queue_position,
    filename: t.filename,
    createdAt: t.created_at,
    startedAt: t.started_at,
    durationSec: t.duration,
    etaSeconds: t.eta_seconds,
    expectedFinishAt: t.expected_finish_at,
    speedRtf: t.speed_rtf,
    recording: byTask.get(t.task_id) ?? null,
  });

  const current = tasks.find((t) => t.queue_position === 0);
  const pending = tasks.filter((t) => t.queue_position != null && t.queue_position > 0).sort((a, b) => a.queue_position! - b.queue_position!);

  const waiting: QueueItem[] = waitingRows
    .filter((r) => !linkedIds.has(r.id))
    .map((r) => ({
      taskId: null,
      kind: r.taskKind,
      status: "QUEUED",
      progress: 0,
      phase: r.phase ?? "WAITING_FOR_WORKER",
      queuePosition: null,
      filename: r.filename,
      createdAt: r.createdAt,
      startedAt: null,
      durationSec: r.durationSec,
      etaSeconds: null,
      expectedFinishAt: null,
      speedRtf: null,
      recording: { id: r.id, title: r.title },
    }));


  const body: QueueResponse = { reachable, error, current: current ? toItem(current) : null, pending: pending.map(toItem), waiting };
  return NextResponse.json(body);
}
