import { NextResponse } from "next/server";
import { listVoices } from "@/lib/voices";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(listVoices());
}
