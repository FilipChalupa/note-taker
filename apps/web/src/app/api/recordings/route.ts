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

const ALLOWED_EXT = /\.(mp3|m4a|wav|aac|ogg|oga|opus|flac|wma|webm|mp4|m4v|mov|mkv|avi|3gp|amr)$/i;

export async function POST(req: Request) {
  ensurePollerStarted();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Neplatný formulář" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Chybí audio soubor" }, { status: 400 });
  }
  if (file.size > config.maxUploadBytes) {
    return NextResponse.json(
      { error: `Soubor je příliš velký (max ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB)` },
      { status: 413 },
    );
  }
  if (!ALLOWED_EXT.test(file.name) && !/^(audio|video)\//.test(file.type)) {
    return NextResponse.json({ error: "Nepodporovaný typ souboru" }, { status: 415 });
  }

  const title = String(form.get("title") ?? "");
  const language = String(form.get("language") ?? config.defaultLanguage).toLowerCase() || config.defaultLanguage;
  const toInt = (v: FormDataEntryValue | null) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const minSpeakers = toInt(form.get("minSpeakers"));
  const maxSpeakers = toInt(form.get("maxSpeakers"));
  if (minSpeakers && maxSpeakers && minSpeakers > maxSpeakers) {
    return NextResponse.json({ error: "Minimální počet mluvčích nesmí být větší než maximální" }, { status: 400 });
  }

  const rec = await createRecording({ title, language, minSpeakers, maxSpeakers, file });
  return NextResponse.json(rec, { status: 201 });
}
