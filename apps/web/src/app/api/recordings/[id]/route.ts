import { NextResponse } from "next/server";
import { deleteRecording, getRecording, updateRecording } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  ensurePollerStarted();
  const { id } = await params;
  const rec = getRecording(id);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: { title?: string; speakerNames?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Neplatné JSON" }, { status: 400 });
  }
  const rec = updateRecording(id, body);
  return rec ? NextResponse.json(rec) : NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = await deleteRecording(id);
  return ok ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
}
