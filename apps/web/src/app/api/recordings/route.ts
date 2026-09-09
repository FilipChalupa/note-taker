import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { createRecording, listRecordings } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  ensurePollerStarted();
  return NextResponse.json(listRecordings());
}

const ALLOWED_EXT = /\.(mp3|mpga|m4a|m4b|wav|aac|ogg|oga|opus|flac|wma|aiff?|mka|webm|mp4|m4v|mov|mkv|avi|mpe?g|ts|3gp|amr)$/i;

export async function POST(req: Request) {
  ensurePollerStarted();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_FORM" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "MISSING_FILE" }, { status: 400 });
  }
  if (file.size > config.maxUploadBytes) {
    return NextResponse.json({ error: `FILE_TOO_LARGE:${Math.round(config.maxUploadBytes / 1024 / 1024)}` }, { status: 413 });
  }
  if (!ALLOWED_EXT.test(file.name) && !/^(audio|video)\//.test(file.type)) {
    return NextResponse.json({ error: "UNSUPPORTED_TYPE" }, { status: 415 });
  }

  const title = String(form.get("title") ?? "");
  const hints = String(form.get("hints") ?? "").slice(0, 2000);
  const language = String(form.get("language") ?? config.defaultLanguage).toLowerCase() || config.defaultLanguage;
  const toInt = (v: FormDataEntryValue | null) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const minSpeakers = toInt(form.get("minSpeakers"));
  const maxSpeakers = toInt(form.get("maxSpeakers"));
  if (minSpeakers && maxSpeakers && minSpeakers > maxSpeakers) {
    return NextResponse.json({ error: "SPEAKER_RANGE" }, { status: 400 });
  }

  const rec = await createRecording({ title, language, hints, minSpeakers, maxSpeakers, file });
  return NextResponse.json(rec, { status: 201 });
}
