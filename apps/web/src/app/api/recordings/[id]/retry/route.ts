import { NextResponse } from "next/server";
import { retryRecording } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rec = await retryRecording(id);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
