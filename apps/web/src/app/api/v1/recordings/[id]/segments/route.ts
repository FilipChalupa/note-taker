import { NextResponse } from "next/server";
import type { SegmentEdit } from "@note-taker/shared";
import { apiFail, requireToken, withApi } from "@/lib/auth";
import { canAccess } from "@/lib/api-v1";
import { editSegments, getRecording, getRecordingRow } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { edits: [{ index, text?, speaker?, start?, end? }] } */
export const PATCH = withApi("recordings.segments.edit", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const token = requireToken(req, "write");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const current = getRecording(id);
  if (!row || !current || !canAccess({ ownerTokenId: row.ownerTokenId, tags: current.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  let body: { edits?: SegmentEdit[] };
  try {
    body = await req.json();
  } catch {
    return { response: apiFail("INVALID_JSON", 400), token, recordingId: id };
  }
  const edits = (body.edits ?? []).filter((e) => Number.isInteger(e.index) && e.index >= 0).slice(0, 500);
  if (!edits.length) return { response: apiFail("INVALID_JSON", 400), token, recordingId: id };
  const rec = editSegments(id, edits);
  return { response: rec ? NextResponse.json({ ok: true, segmentCount: rec.segments.length }) : apiFail("NOT_FOUND", 404), token, recordingId: id };
});
