import { NextResponse } from "next/server";
import { splitSegment, splitSegmentPatch } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { index, position } – split a segment at a character position of its text. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { index?: unknown; position?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (!Number.isInteger(body.index) || !Number.isInteger(body.position)) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const light = new URL(req.url).searchParams.get("light") === "1";
  const rec = light ? splitSegmentPatch(id, body.index as number, body.position as number) : splitSegment(id, body.index as number, body.position as number);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
