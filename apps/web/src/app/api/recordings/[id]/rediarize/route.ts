import { NextResponse } from "next/server";
import { rediarizeRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { minSpeakers?: unknown; maxSpeakers?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const toInt = (v: unknown) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= 30 ? n : undefined;
  };
  const minSpeakers = toInt(body.minSpeakers);
  const maxSpeakers = toInt(body.maxSpeakers);
  if (minSpeakers && maxSpeakers && minSpeakers > maxSpeakers) {
    return NextResponse.json({ error: "SPEAKER_RANGE" }, { status: 400 });
  }
  const res = await rediarizeRecording(id, { minSpeakers, maxSpeakers });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.recording);
}
