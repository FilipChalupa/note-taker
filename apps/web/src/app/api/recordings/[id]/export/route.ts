import { NextResponse } from "next/server";
import type { ExportFormat } from "@note-taker/shared";
import { getRecording } from "@/lib/recordings";
import { exportTranscript, safeFilename } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FORMATS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = (new URL(req.url).searchParams.get("format") ?? "md") as ExportFormat;
  if (!FORMATS.includes(format)) return NextResponse.json({ error: "Neznámý formát" }, { status: 400 });

  const rec = getRecording(id);
  if (!rec) return NextResponse.json({ error: "Nenalezeno" }, { status: 404 });
  if (rec.status !== "COMPLETED") return NextResponse.json({ error: "Přepis ještě není hotový" }, { status: 409 });

  const { body, mime, ext } = exportTranscript(rec, format);
  const filename = `${safeFilename(rec.title)}.${ext}`;
  return new NextResponse(body, {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
