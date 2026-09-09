import { NextResponse } from "next/server";
import type { TranscriptSegment } from "@note-taker/shared";
import { replaceTranscript } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PUT { segments, speakers, speakerNames } – used by undo to restore a previous transcript state. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { segments?: TranscriptSegment[]; speakers?: string[]; speakerNames?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.segments) || !Array.isArray(body.speakers)) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const rec = replaceTranscript(id, body.segments, body.speakers, body.speakerNames ?? {});
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
