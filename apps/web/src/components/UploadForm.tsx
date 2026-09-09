"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingDetail } from "@note-taker/shared";
import { errorLabel, LANGUAGE_CODES } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { useDroppedFile } from "./DropProvider";
import { requestWorkerRefresh } from "./WorkerStatus";

const ACCEPT = ".mp3,.mpga,.m4a,.m4b,.wav,.aac,.ogg,.oga,.opus,.flac,.wma,.aif,.aiff,.mka,.webm,.mp4,.m4v,.mov,.mkv,.avi,.mpg,.mpeg,.ts,.3gp,.amr,audio/*,video/*";

function fmtBytes(b: number): string {
  if (b > 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} kB`;
}

export function UploadForm({ defaultLanguage, maxUploadBytes }: { defaultLanguage: string; maxUploadBytes: number }) {
  const { m } = useI18n();
  const router = useRouter();
  const { takePendingFile } = useDroppedFile();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(defaultLanguage);
  const [hints, setHints] = useState("");
  const [tags, setTags] = useState("");
  const [minSpeakers, setMinSpeakers] = useState("");
  const [maxSpeakers, setMaxSpeakers] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      if (f.size > maxUploadBytes) {
        setError(fmt(m.errors.FILE_TOO_LARGE, { mb: Math.round(maxUploadBytes / 1024 / 1024) }));
        return;
      }
      setError(null);
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    },
    [maxUploadBytes, title, m],
  );

  // File dropped anywhere in the app (DropProvider) - on mount and on later drops while on this page
  useEffect(() => {
    const consume = () => {
      const f = takePendingFile();
      if (f) pick(f);
    };
    consume();
    window.addEventListener("note-taker:file-dropped", consume);
    return () => window.removeEventListener("note-taker:file-dropped", consume);
  }, [takePendingFile, pick]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError(m.upload.selectFile);
      return;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("title", title);
    form.append("language", language);
    if (hints.trim()) form.append("hints", hints.trim());
    if (tags.trim()) form.append("tags", tags.trim());
    if (minSpeakers) form.append("minSpeakers", minSpeakers);
    if (maxSpeakers) form.append("maxSpeakers", maxSpeakers);

    setError(null);
    setProgress(0);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/recordings");
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const rec = JSON.parse(xhr.responseText) as RecordingDetail;
        requestWorkerRefresh();
        router.push(`/recordings/${rec.id}`);
      } else {
        let msg = fmt(m.errors.HTTP, { status: xhr.status });
        try {
          const code = (JSON.parse(xhr.responseText) as { error?: string }).error;
          if (code) msg = errorLabel(code, m) ?? msg;
        } catch {
          /* ignore */
        }
        setError(msg);
        setProgress(null);
      }
    };
    xhr.onerror = () => {
      setError(m.errors.NETWORK);
      setProgress(null);
    };
    xhr.send(form);
  };

  const uploading = progress !== null;

  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      <div
        onClick={() => inputRef.current?.click()}
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 px-6 py-10 text-center transition hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <>
            <div className="text-base font-medium">{file.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{fmtBytes(file.size)} · {m.upload.clickToChange}</div>
          </>
        ) : (
          <>
            <div className="text-3xl">🎧</div>
            <div className="mt-2 font-medium">{m.upload.dropHere}</div>
            <div className="mt-1 text-sm text-zinc-500">{m.upload.formats}</div>
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">{m.upload.name}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.upload.namePlaceholder} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">{m.upload.language}</label>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGE_CODES.map((code) => (
              <option key={code} value={code}>
                {m.languages[code]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{m.upload.minSpeakers}</label>
          <input className="input" type="number" min={1} max={20} value={minSpeakers} onChange={(e) => setMinSpeakers(e.target.value)} placeholder={m.upload.optional} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">{m.upload.maxSpeakers}</label>
          <input className="input" type="number" min={1} max={20} value={maxSpeakers} onChange={(e) => setMaxSpeakers(e.target.value)} placeholder={m.upload.optional} />
        </div>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        {m.upload.speakersHint}
      </p>

      <div>
        <label className="mb-1 block text-sm font-medium">{m.upload.tags}</label>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder={m.tags.placeholder} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">{m.upload.hints}</label>
        <textarea className="input min-h-[72px]" value={hints} onChange={(e) => setHints(e.target.value)} placeholder={m.upload.hintsPlaceholder} />
        <p className="mt-1 text-xs text-zinc-500">{m.upload.hintsHelp}</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {uploading && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{progress! < 100 ? m.upload.uploading : m.upload.handingOver}</span>
            <span>{progress} %</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
          {uploading ? m.upload.submitting : m.upload.submit}
        </button>
      </div>
    </form>
  );
}
