import { NextResponse } from "next/server";
import { getStorageInfo } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getStorageInfo());
}
