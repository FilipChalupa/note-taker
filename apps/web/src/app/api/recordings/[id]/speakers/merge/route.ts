import { NextResponse } from "next/server";
import { mergeSpeakers } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { from: "SPEAKER_02", into: "SPEAKER_00" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { from?: string; into?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const ok = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_]{1,40}$/.test(v);
  if (!ok(body.from) || !ok(body.into)) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const rec = mergeSpeakers(id, body.from, body.into);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
