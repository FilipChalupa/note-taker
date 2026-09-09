import { NextResponse } from "next/server";
import { addSubscription, removeSubscription } from "@/lib/push";
import { getLocale } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Sub = { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };

export async function POST(req: Request) {
  let body: Sub;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  if (typeof body.endpoint !== "string" || typeof body.keys?.p256dh !== "string" || typeof body.keys?.auth !== "string") {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  addSubscription({ endpoint: body.endpoint, keys: { p256dh: body.keys.p256dh, auth: body.keys.auth } }, await getLocale());
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  let body: { endpoint?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* ignore */
  }
  if (typeof body.endpoint === "string") removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
