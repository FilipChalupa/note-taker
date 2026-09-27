import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { rawDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Test-only: wipe every table and stored file so each end-to-end spec file starts from an empty library.
 * Exists only when NOTE_TAKER_E2E=1, which only the Playwright setup sets; otherwise it is a plain 404.
 */
export async function POST() {
  if (process.env.NOTE_TAKER_E2E !== "1") return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const sql = rawDb();
  sql.exec(`
    DELETE FROM recordings;
    DELETE FROM recordings_fts;
    DELETE FROM voices;
    DELETE FROM api_tokens;
    DELETE FROM audit_log;
    DELETE FROM intake_imports;
    DELETE FROM push_subscriptions;
    DELETE FROM settings WHERE key NOT IN ('vapid_public', 'vapid_private', 'audio_signing_secret');
  `);
  for (const dir of ["recordings", "tmp"]) fs.rmSync(path.join(config.dataDir, dir), { recursive: true, force: true });
  // in-memory state that would otherwise leak between spec files
  const g = globalThis as Record<string, unknown>;
  (g.__noteTakerApiLimits as Map<string, unknown> | undefined)?.clear();
  return new NextResponse(null, { status: 204 });
}
