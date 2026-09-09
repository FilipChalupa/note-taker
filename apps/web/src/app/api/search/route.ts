import { NextResponse } from "next/server";
import { searchRecordings } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 200);
  return NextResponse.json({ q, hits: q ? searchRecordings(q) : [] });
}
