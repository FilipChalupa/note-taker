import { NextResponse } from "next/server";
import type { ExportFormat } from "@note-taker/shared";
import { apiFail, requireToken, withApi } from "@/lib/auth";
import { canAccess, publicSegments } from "@/lib/api-v1";
import { exportTranscript } from "@/lib/export";
import { getRecording, getRecordingRow } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TEXT_FORMATS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

/** ?format=json|md|txt|srt|vtt and ?words=true for word timestamps. */
export const GET = withApi("recordings.transcript", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const token = requireToken(req, "any");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const rec = getRecording(id);
  if (!row || !rec || !canAccess({ ownerTokenId: row.ownerTokenId, tags: rec.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  if (rec.status !== "COMPLETED") {
    return { response: apiFail("NOT_FINISHED", 409, { status: rec.status, progress: rec.progress, phase: rec.phase }), token, recordingId: id };
  }
  const p = new URL(req.url).searchParams;
  const format = (p.get("format") ?? "json") as ExportFormat | "json";
  if (format !== "json" && TEXT_FORMATS.includes(format)) {
    const { body } = exportTranscript(rec, format, "en");
    return { response: NextResponse.json({ id, format, content: body }), token, recordingId: id };
  }
  return {
    response: NextResponse.json({
      id,
      language: rec.language,
      durationSeconds: rec.durationSec,
      speakers: rec.speakers.map((s) => ({ id: s, name: rec.speakerNames[s] ?? null })),
      segments: publicSegments(rec, p.get("words") === "true"),
    }),
    token,
    recordingId: id,
  };
});
