import { NextResponse } from "next/server";
import type { RecordingSort } from "@note-taker/shared";
import { config, SUPPORTED_MEDIA } from "@/lib/config";
import { apiFail, hasScope, requireToken, withApi } from "@/lib/auth";
import { publicRecording } from "@/lib/api-v1";
import { createRecording, listRecordings } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SORTS: RecordingSort[] = ["newest", "oldest", "title", "longest", "shortest"];

export const GET = withApi("recordings.list", async (req) => {
  const token = requireToken(req, "any");
  ensurePollerStarted();
  const p = new URL(req.url).searchParams;
  const sort = p.get("sort") as RecordingSort | null;
  const limit = Math.min(200, Math.max(1, Number(p.get("limit")) || 25));
  const page = Math.max(1, Number(p.get("page")) || 1);
  const all = listRecordings({
    tag: p.get("tag") ?? token.tagFilter ?? undefined,
    view: p.get("archived") === "true" ? "all" : "active",
    sort: sort && SORTS.includes(sort) ? sort : "newest",
    // a submit-only token sees nothing but its own uploads
    ownerTokenId: hasScope(token, "read") ? undefined : token.id,
  });
  const status = p.get("status");
  const filtered = status ? all.filter((r) => r.status === status) : all;
  const items = filtered.slice((page - 1) * limit, page * limit);
  return {
    response: NextResponse.json({ items: items.map((r) => publicRecording(r)), total: filtered.length, page, limit }),
    token,
  };
});

/** multipart/form-data: file plus optional title, language, tags, hints, notes, minSpeakers, maxSpeakers. */
export const POST = withApi("recordings.create", async (req) => {
  const token = requireToken(req, ["submit", "write"], { submit: true });
  ensurePollerStarted();
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return { response: apiFail("INVALID_FORM", 400), token };
  }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { response: apiFail("MISSING_FILE", 400), token };
  if (file.size > config.maxUploadBytes) return { response: apiFail("FILE_TOO_LARGE", 413, { maxBytes: config.maxUploadBytes }), token };
  if (!SUPPORTED_MEDIA.test(file.name) && !/^(audio|video)\//.test(file.type)) return { response: apiFail("UNSUPPORTED_TYPE", 415), token };

  const int = (v: FormDataEntryValue | null) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  const tags = [String(form.get("tags") ?? ""), token.tagFilter ?? ""].filter(Boolean).join(",");
  const rec = await createRecording({
    title: String(form.get("title") ?? ""),
    language: String(form.get("language") ?? config.defaultLanguage).toLowerCase(),
    hints: String(form.get("hints") ?? ""),
    notes: String(form.get("notes") ?? ""),
    tags,
    minSpeakers: int(form.get("minSpeakers")),
    maxSpeakers: int(form.get("maxSpeakers")),
    ownerTokenId: token.id,
    file,
  });
  return { response: NextResponse.json(publicRecording(rec), { status: 201 }), token, recordingId: rec.id };
});
