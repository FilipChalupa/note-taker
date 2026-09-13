import { NextResponse } from "next/server";
import { collectIntake, intakeStatus } from "@/lib/intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(intakeStatus());
}

/** POST: collect immediately instead of waiting for the next poll. */
export async function POST() {
  return NextResponse.json(await collectIntake());
}
