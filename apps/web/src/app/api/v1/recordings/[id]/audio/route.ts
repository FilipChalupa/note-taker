import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { apiFail, requireToken } from "@/lib/auth";
import { canAccess } from "@/lib/api-v1";
import { getRecording, getRecordingRow } from "@/lib/recordings";
import { signAudioPath, verifyAudioSignature } from "@/lib/signed-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = { ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ogg": "audio/ogg", ".webm": "audio/webm", ".flac": "audio/flac" };

/** Bearer token, or a short-lived signed link produced by ?sign=true (handy for tools that cannot set headers). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const signed = verifyAudioSignature(id, url.searchParams.get("exp"), url.searchParams.get("sig"));
  if (!signed) {
    try {
      const token = requireToken(req, "any");
      const row = getRecordingRow(id);
      const rec = getRecording(id);
      if (!row || !rec || !canAccess({ ownerTokenId: row.ownerTokenId, tags: rec.tags }, token)) return apiFail("NOT_FOUND", 404);
      if (url.searchParams.get("sign") === "true") {
        const ttl = Number(url.searchParams.get("ttl")) || 900;
        return NextResponse.json({ url: signAudioPath(id, ttl), expiresInSeconds: Math.min(86400, Math.max(30, ttl)) });
      }
    } catch (err) {
      const e = err as { code?: string; status?: number };
      return apiFail(e.code ?? "UNAUTHORIZED", e.status ?? 401);
    }
  }
  const row = getRecordingRow(id);
  if (!row) return apiFail("NOT_FOUND", 404);
  const file = row.audioPath && fs.existsSync(row.audioPath) ? row.audioPath : fs.existsSync(row.originalPath) ? row.originalPath : null;
  if (!file) return apiFail("AUDIO_UNAVAILABLE", 404);
  const size = fs.statSync(file).size;
  return new NextResponse(Readable.toWeb(fs.createReadStream(file)) as never, {
    headers: {
      "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Cache-Control": "private, no-store",
    },
  });
}
