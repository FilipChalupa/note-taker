import { NextResponse } from "next/server";
import type { ExportFormat } from "@note-taker/shared";
import { getRecording } from "@/lib/recordings";
import { exportTranscript, safeFilename } from "@/lib/export";
import { getLocale, getTimeZone } from "@/lib/i18n/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = (new URL(req.url).searchParams.get("format") ?? "md") as ExportFormat;
  if (!FORMATS.includes(format)) return NextResponse.json({ error: "UNKNOWN_FORMAT" }, { status: 400 });

  const rec = getRecording(id);
  if (!rec) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  if (rec.status !== "COMPLETED") return NextResponse.json({ error: "NOT_FINISHED" }, { status: 409 });

  const { body, mime, ext } = exportTranscript(rec, format, await getLocale(), await getTimeZone());
  const filename = `${safeFilename(rec.title)}.${ext}`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
