import { NextResponse } from "next/server";
import { apiFail, requireToken, withApi } from "@/lib/auth";
import { canAccess, speakerStats } from "@/lib/api-v1";
import { getRecording, getRecordingRow, mergeSpeakers, updateRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApi("recordings.speakers", async (req: Request, ctx: Ctx) => {
  const token = requireToken(req, "any");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const rec = getRecording(id);
  if (!row || !rec || !canAccess({ ownerTokenId: row.ownerTokenId, tags: rec.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  return {
    response: NextResponse.json({
      speakers: rec.speakers.map((s) => ({ id: s, name: rec.speakerNames[s] ?? null, suggestion: rec.speakerSuggestions[s] ?? null })),
      stats: speakerStats(rec),
    }),
    token,
    recordingId: id,
  };
});

/** POST { names?: {SPEAKER_00: "Filip"}, merge?: { from, into } } */
export const POST = withApi("recordings.speakers.update", async (req: Request, ctx: Ctx) => {
  const token = requireToken(req, "write");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const current = getRecording(id);
  if (!row || !current || !canAccess({ ownerTokenId: row.ownerTokenId, tags: current.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  let body: { names?: Record<string, string>; merge?: { from: string; into: string } };
  try {
    body = await req.json();
  } catch {
    return { response: apiFail("INVALID_JSON", 400), token, recordingId: id };
  }
  if (body.merge) {
    const ok = /^[A-Za-z0-9_]{1,40}$/.test(body.merge.from) && /^[A-Za-z0-9_]{1,40}$/.test(body.merge.into);
    if (!ok) return { response: apiFail("INVALID_JSON", 400), token, recordingId: id };
    mergeSpeakers(id, body.merge.from, body.merge.into);
  }
  if (body.names) updateRecording(id, { speakerNames: { ...getRecording(id)!.speakerNames, ...body.names } });
  const rec = getRecording(id)!;
  return {
    response: NextResponse.json({ speakers: rec.speakers.map((s) => ({ id: s, name: rec.speakerNames[s] ?? null })) }),
    token,
    recordingId: id,
  };
});
