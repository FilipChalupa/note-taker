import { NextResponse } from "next/server";
import { apiFail, requireToken, withApi } from "@/lib/auth";
import { getRecording, searchRecordings } from "@/lib/recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withApi("search", async (req) => {
  const token = requireToken(req, "read");
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
  if (!q) return { response: apiFail("MISSING_QUERY", 400), token };
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const hits = searchRecordings(q, limit)
    .filter((h) => {
      if (!token.tagFilter) return true;
      const rec = getRecording(h.id);
      return rec?.tags.some((t) => t.toLowerCase() === token.tagFilter!.toLowerCase()) ?? false;
    })
    .map((h) => ({ id: h.id, title: h.title, createdAt: h.createdAt, durationSeconds: h.durationSec, snippet: h.snippet.replace(/<\/?mark>/g, "**") }));
  return { response: NextResponse.json({ query: q, hits }), token };
});
