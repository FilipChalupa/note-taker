import { NextResponse } from "next/server";
import { listAudit } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const limit = Number(new URL(req.url).searchParams.get("limit")) || 30;
  return NextResponse.json(listAudit(limit));
}
