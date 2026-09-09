import { NextResponse } from "next/server";
import type { BulkAction } from "@note-taker/shared";
import { bulkAction } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS: BulkAction[] = ["delete", "addTag", "removeTag", "archive", "unarchive", "favorite", "unfavorite"];

/** POST { ids: string[], action, tag? } */
export async function POST(req: Request) {
  let body: { ids?: unknown; action?: unknown; tag?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500) : [];
  const action = body.action as BulkAction;
  if (ids.length === 0 || !ACTIONS.includes(action)) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const tag = typeof body.tag === "string" ? body.tag.trim().slice(0, 40) : undefined;
  if ((action === "addTag" || action === "removeTag") && !tag) return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  const affected = await bulkAction(ids, action, tag);
  return NextResponse.json({ affected });
}
