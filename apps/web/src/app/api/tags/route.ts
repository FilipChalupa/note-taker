import { NextResponse } from "next/server";
import { listTags } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listTags());
}
