import { NextResponse } from "next/server";
import { config, SUPPORTED_MEDIA } from "@/lib/config";
import { createRecording } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Web Share Target (see manifest.ts): the installed PWA appears in the phone's Share sheet for
 * audio/video files. The browser POSTs multipart form data here; we create the recording and
 * redirect to it. Multiple shared files each become a recording.
 */
export async function POST(req: Request) {
  ensurePollerStarted();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(new URL("/upload", req.url), 303);
  }
  const files = form.getAll("media").filter((f): f is File => f instanceof File && f.size > 0);
  const sharedTitle = String(form.get("title") ?? "").trim();
  const text = String(form.get("text") ?? "").trim();
  let lastId: string | null = null;
  for (const file of files) {
    if (!SUPPORTED_MEDIA.test(file.name) && !/^(audio|video)\//.test(file.type)) continue;
    const title = files.length === 1 && sharedTitle ? sharedTitle : "";
    const rec = await createRecording({ title, language: config.defaultLanguage, tags: ["shared"], notes: text || undefined, file });
    lastId = rec.id;
  }
  return NextResponse.redirect(new URL(lastId ? `/recordings/${lastId}` : "/upload", req.url), 303);
}

export async function GET(req: Request) {
  return NextResponse.redirect(new URL("/upload", req.url), 303);
}
