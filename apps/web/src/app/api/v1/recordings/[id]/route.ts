import { NextResponse } from "next/server";
import { apiFail, hasScope, requireToken, withApi } from "@/lib/auth";
import { canAccess, publicRecording } from "@/lib/api-v1";
import { deleteRecording, getRecording, getRecordingRow, updateRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withApi("recordings.get", async (req: Request, ctx: Ctx) => {
  const token = requireToken(req, "any");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const rec = getRecording(id);
  if (!row || !rec || !canAccess({ ownerTokenId: row.ownerTokenId, tags: rec.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  return { response: NextResponse.json(publicRecording(rec)), token, recordingId: id };
});

export const PATCH = withApi("recordings.update", async (req: Request, ctx: Ctx) => {
  const token = requireToken(req, "write");
  const { id } = await ctx.params;
  const row = getRecordingRow(id);
  const current = getRecording(id);
  if (!row || !current || !canAccess({ ownerTokenId: row.ownerTokenId, tags: current.tags }, token)) {
    return { response: apiFail("NOT_FOUND", 404), token, recordingId: id };
  }
  let body: { title?: string; tags?: string | string[]; notes?: string | null; speakerNames?: Record<string, string>; favorite?: boolean; archived?: boolean };
  try {
    body = await req.json();
  } catch {
    return { response: apiFail("INVALID_JSON", 400), token, recordingId: id };
  }
  const rec = updateRecording(id, body);
  return { response: rec ? NextResponse.json(publicRecording(rec)) : apiFail("NOT_FOUND", 404), token, recordingId: id };
});

export const DELETE = withApi("recordings.delete", async (req: Request, ctx: Ctx) => {
  const token = requireToken(req, "admin");
  const { id } = await ctx.params;
  if (!hasScope(token, "admin")) return { response: apiFail("FORBIDDEN_SCOPE", 403), token, recordingId: id };
  const ok = await deleteRecording(id);
  return { response: ok ? new NextResponse(null, { status: 204 }) : apiFail("NOT_FOUND", 404), token, recordingId: id };
});
