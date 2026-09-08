"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import type { RecordingDetail } from "@note-taker/shared";
import { LANGUAGES } from "@/lib/format";

const ACCEPT = ".mp3,.m4a,.wav,.aac,.ogg,.oga,.opus,.flac,.wma,.webm,.mp4,.m4v,.mov,.mkv,.avi,.3gp,.amr,audio/*,video/*";

function fmtBytes(b: number): string {
  if (b > 1024 * 1024 * 1024) return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(b / 1024)} kB`;
}

export function UploadForm({ defaultLanguage, maxUploadBytes }: { defaultLanguage: string; maxUploadBytes: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState(defaultLanguage);
  const [minSpeakers, setMinSpeakers] = useState("");
  const [maxSpeakers, setMaxSpeakers] = useState("");
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = useCallback(
    (f: File | undefined) => {
      if (!f) return;
      if (f.size > maxUploadBytes) {
        setError(`Soubor je příliš velký (max ${fmtBytes(maxUploadBytes)})`);
        return;
      }
      setError(null);
      setFile(f);
      if (!title) setTitle(f.name.replace(/\.[^.]+$/, ""));
    },
    [maxUploadBytes, title],
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError("Vyberte audio soubor");
      return;
    }
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("title", title);
    form.append("language", language);
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
        router.push(`/recordings/${rec.id}`);
      } else {
        let msg = `Chyba ${xhr.status}`;
        try {
          msg = (JSON.parse(xhr.responseText) as { error?: string }).error ?? msg;
        } catch {
          /* ignore */
        }
        setError(msg);
        setProgress(null);
      }
    };
    xhr.onerror = () => {
      setError("Nahrávání selhalo (síťová chyba)");
      setProgress(null);
    };
    xhr.send(form);
  };

  const uploading = progress !== null;

  return (
    <form onSubmit={submit} className="card space-y-5 p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          pick(e.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-10 text-center transition ${
          dragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
            : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500"
        }`}
      >
        <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        {file ? (
          <>
            <div className="text-base font-medium">{file.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{fmtBytes(file.size)} · klikněte pro změnu</div>
          </>
        ) : (
          <>
            <div className="text-3xl">🎧</div>
            <div className="mt-2 font-medium">Přetáhněte sem audio nebo klikněte pro výběr</div>
            <div className="mt-1 text-sm text-zinc-500">MP3, M4A, WAV, AAC, OGG, FLAC, MP4/MOV (zvuková stopa)…</div>
          </>
        )}
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Název schůzky</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Např. Týdenní sync 8. 9." />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium">Jazyk</label>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Min. mluvčích</label>
          <input className="input" type="number" min={1} max={20} value={minSpeakers} onChange={(e) => setMinSpeakers(e.target.value)} placeholder="volitelné" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Max. mluvčích</label>
          <input className="input" type="number" min={1} max={20} value={maxSpeakers} onChange={(e) => setMaxSpeakers(e.target.value)} placeholder="volitelné" />
        </div>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">
        Odhad počtu mluvčích zpřesní diarizaci. Pokud znáte přesný počet, zadejte stejné číslo do obou polí.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {uploading && (
        <div>
          <div className="mb-1 flex justify-between text-xs text-zinc-500">
            <span>{progress! < 100 ? "Nahrávám na server…" : "Předávám workeru…"}</span>
            <span>{progress} %</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button type="submit" className="btn btn-primary" disabled={uploading || !file}>
          {uploading ? "Nahrávám…" : "Nahrát a přepsat"}
        </button>
      </div>
    </form>
  );
}
