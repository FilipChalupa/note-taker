import { NextResponse } from "next/server";
import { getAppSettings, setSetting } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getAppSettings());
}

export async function PUT(req: Request) {
  let body: { glossary?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (typeof body.glossary === "string") setSetting("glossary", body.glossary.slice(0, 20_000));
  return NextResponse.json(getAppSettings());
}
