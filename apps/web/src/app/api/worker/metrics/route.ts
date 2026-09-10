import { NextResponse } from "next/server";
import { workerClient } from "@/lib/worker-client";
import { getLibraryStats } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const library = getLibraryStats();
  try {
    return NextResponse.json({ reachable: true, library, worker: await workerClient.metrics() });
  } catch (err) {
    return NextResponse.json({ reachable: false, library, worker: null, error: (err as Error).message });
  }
}
