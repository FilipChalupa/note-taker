import { NextResponse } from "next/server";
import type { SegmentEdit } from "@note-taker/shared";
import { editSegments } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PATCH { edits: [{ index, text?, speaker? }] } */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { edits?: SegmentEdit[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const edits = (body.edits ?? []).filter((e) => Number.isInteger(e.index) && e.index >= 0).slice(0, 500);
  if (edits.length === 0) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const rec = editSegments(id, edits);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
