import { NextResponse } from "next/server";
import type { ApiTokenScope } from "@note-taker/shared";
import { SCOPES, createApiToken, listApiTokens } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Token management for the browser UI (LAN only, like the rest of /api/*). */
export async function GET() {
  return NextResponse.json(listApiTokens());
}

export async function POST(req: Request) {
  let body: { name?: unknown; scopes?: unknown; tagFilter?: unknown; expiresInDays?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const scopes = Array.isArray(body.scopes) ? (body.scopes.filter((s): s is ApiTokenScope => typeof s === "string" && SCOPES.includes(s as ApiTokenScope)) as ApiTokenScope[]) : [];
  if (typeof body.name !== "string" || !body.name.trim() || scopes.length === 0) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const days = Number(body.expiresInDays);
  const created = createApiToken({
    name: body.name,
    scopes,
    tagFilter: typeof body.tagFilter === "string" ? body.tagFilter : null,
    expiresInDays: Number.isFinite(days) && days > 0 ? days : null,
  });
  return NextResponse.json(created, { status: 201 });
}
