import { NextResponse } from "next/server";
import { deleteApiToken, revokeApiToken } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** POST revokes (keeps the audit trail), DELETE removes the row entirely. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return revokeApiToken(id) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return deleteApiToken(id) ? new NextResponse(null, { status: 204 }) : NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
