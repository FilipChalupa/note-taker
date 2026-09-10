import { NextResponse } from "next/server";
import { applySpeakerSuggestions, recordingHead } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { speakers?: string[] } – name speakers after their suggested known voices. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { speakers?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = all */
  }
  const speakers = Array.isArray(body.speakers) ? body.speakers.filter((s): s is string => typeof s === "string") : undefined;
  const rec = applySpeakerSuggestions(id, speakers);
  if (!rec) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (new URL(req.url).searchParams.get("light") === "1") return NextResponse.json({ recording: recordingHead(id), patch: { kind: "none" } });
  return NextResponse.json(rec);
}
