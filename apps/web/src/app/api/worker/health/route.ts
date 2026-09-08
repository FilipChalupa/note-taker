import { NextResponse } from "next/server";
import { workerClient } from "@/lib/worker-client";
import { config } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await workerClient.health();
    return NextResponse.json({ reachable: true, url: config.workerApiUrl, health });
  } catch (err) {
    return NextResponse.json({ reachable: false, url: config.workerApiUrl, error: (err as Error).message });
  }
}
