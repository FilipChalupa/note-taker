import { NextResponse } from "next/server";
import { validateTrackSpecs, type TrackSpec } from "@note-taker/shared";
import { retryRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST, optional body { tracks: TrackSpec[] | null } to choose the audio streams of a multi-track file (null = automatic). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { tracks?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  let tracks: TrackSpec[] | null | undefined;
  if (body.tracks === null) tracks = null;
  else if (body.tracks !== undefined) {
    const checked = validateTrackSpecs(body.tracks);
    if ("error" in checked) return NextResponse.json({ error: checked.error }, { status: 400 });
    tracks = checked.tracks;
  }
  const rec = await retryRecording(id, { tracks });
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
