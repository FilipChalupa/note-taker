"use client";

import { useState } from "react";
import type { AppSettings, StorageInfo } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatBytes } from "@/lib/format";

export function SettingsView({ initial, storage }: { initial: AppSettings; storage: StorageInfo }) {
  const { m } = useI18n();
  const [glossary, setGlossary] = useState(initial.glossary);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async () => {
    setState("saving");
    const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ glossary }) });
    if (r.ok) {
      setGlossary(((await r.json()) as AppSettings).glossary);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } else setState("idle");
  };

  const used = storage.totalBytes;
  const pct = storage.volumeTotalBytes ? Math.min(100, (100 * used) / storage.volumeTotalBytes) : 0;

  return (
    <div className="space-y-5">
      <section className="card p-5">
        <h2 className="font-semibold">{m.settings.glossary}</h2>
        <p className="mb-3 mt-1 text-sm text-zinc-500">{m.settings.glossaryHelp}</p>
        <textarea className="input min-h-[160px] font-mono text-sm" value={glossary} onChange={(e) => setGlossary(e.target.value)} />
        <div className="mt-3 flex items-center gap-3">
          <button className="btn btn-primary" onClick={save} disabled={state === "saving"}>
            {m.settings.save}
          </button>
          {state === "saved" && <span className="text-sm text-emerald-600">{m.settings.saved}</span>}
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">{m.settings.storage}</h2>
        <p className="mt-1 text-sm text-zinc-500">
          {fmt(m.settings.recordingsCount, { n: storage.recordings })} · <code className="text-xs">{storage.dataDir}</code>
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
          <dt className="text-zinc-500">{m.settings.originals}</dt>
          <dd className="font-medium tabular-nums">{formatBytes(storage.originalsBytes)}</dd>
          <dt className="text-zinc-500">{m.settings.audio}</dt>
          <dd className="font-medium tabular-nums">{formatBytes(storage.audioBytes)}</dd>
          <dt className="text-zinc-500">{m.settings.database}</dt>
          <dd className="font-medium tabular-nums">{formatBytes(storage.databaseBytes)}</dd>
          <dt className="text-zinc-500">{m.settings.total}</dt>
          <dd className="font-semibold tabular-nums">{formatBytes(used)}</dd>
        </dl>
        {storage.volumeTotalBytes != null && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>{m.settings.free}</span>
              <span className="tabular-nums">
                {formatBytes(storage.volumeFreeBytes ?? 0)} / {formatBytes(storage.volumeTotalBytes)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} title={formatBytes(used)} />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
