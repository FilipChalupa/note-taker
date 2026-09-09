import { NextResponse } from "next/server";
import { deleteVoice, renameVoice } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: { name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const v = renameVoice(id, body.name);
  return v ? NextResponse.json(v) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return deleteVoice(id) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
