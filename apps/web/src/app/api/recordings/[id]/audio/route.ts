import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { getRecordingRow } from "@/lib/recordings";
import { safeFilename } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".mp4": "video/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".mka": "audio/x-matroska",
  ".m4b": "audio/mp4",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
};

/** Serve normalized audio (or the original upload while processing) with HTTP Range support. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getRecordingRow(id);
  if (!row) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const file =
    row.audioPath && fs.existsSync(row.audioPath)
      ? row.audioPath
      : fs.existsSync(row.originalPath)
        ? row.originalPath
        : null;
  if (!file) return NextResponse.json({ error: "AUDIO_UNAVAILABLE" }, { status: 404 });

  const size = fs.statSync(file).size;
  const mime = MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const range = req.headers.get("range");

  const baseHeaders: Record<string, string> = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };
  // ?download=1 -> save as "<title>.<ext>" instead of playing inline
  if (new URL(req.url).searchParams.get("download")) {
    const filename = `${safeFilename(row.title)}${path.extname(file).toLowerCase()}`;
    baseHeaders["Content-Disposition"] = `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  }

  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    let start = m[1] ? Number(m[1]) : 0;
    let end = m[2] ? Number(m[2]) : size - 1;
    if (!m[1] && m[2]) {
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = fs.createReadStream(file, { start, end });
    return new NextResponse(Readable.toWeb(stream) as never, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  const stream = fs.createReadStream(file);
  return new NextResponse(Readable.toWeb(stream) as never, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(size) },
  });
}
