import { NextResponse } from "next/server";
import { requireToken, withApi } from "@/lib/auth";
import { getLibraryStats } from "@/lib/recordings";
import { workerClient } from "@/lib/worker-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Processing capacity, without exposing worker internals. */
export const GET = withApi("status", async (req) => {
  const token = requireToken(req, "read");
  const library = getLibraryStats();
  try {
    const health = await workerClient.health();
    return {
      response: NextResponse.json({
        transcriptionAvailable: health.ok,
        acceleration: health.cuda.available ? "gpu" : "cpu",
        model: health.model,
        diarization: health.diarization_enabled,
        queued: health.queue.pending + (health.queue.current_task_id ? 1 : 0),
        library: { recordings: library.recordings, completed: library.completed, audioHours: Math.round((library.audioSeconds / 3600) * 10) / 10 },
      }),
      token,
    };
  } catch {
    return {
      response: NextResponse.json({ transcriptionAvailable: false, queued: null, library: { recordings: library.recordings, completed: library.completed, audioHours: Math.round((library.audioSeconds / 3600) * 10) / 10 } }),
      token,
    };
  }
});
