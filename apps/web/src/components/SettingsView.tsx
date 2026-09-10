"use client";

import { useState } from "react";
import type { AppSettings, StorageInfo, Voice, WorkerMetrics } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatBytes } from "@/lib/format";
import { NotificationsToggle } from "./NotificationsToggle";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { api } from "@/lib/api-client";

type LibraryStats = { recordings: number; completed: number; failed: number; audioSeconds: number; speakersNamed: number };

function MetricsSection({ library, worker }: { library: LibraryStats; worker: WorkerMetrics | null }) {
  const { m } = useI18n();
  const hours = (sec: number) => (sec / 3600).toFixed(1);
  const days = worker?.days.slice(-14) ?? [];
  const max = Math.max(1, ...days.map((d) => d.audio_seconds));
  const t = worker?.totals;
  return (
    <section className="card p-5" data-testid="metrics">
      <h2 className="font-semibold">{m.metrics.title}</h2>
      <p className="mt-1 text-sm text-zinc-500">
        {fmt(m.metrics.library, { n: library.recordings, h: hours(library.audioSeconds), s: library.speakersNamed })}
      </p>
      {!worker ? (
        <p className="mt-3 text-sm text-amber-700 dark:text-amber-300">{m.metrics.offline}</p>
      ) : !t || t.completed + t.failed === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">{m.metrics.none}</p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-4">
            <div>
              <dt className="text-xs text-zinc-500">{m.metrics.hours}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{hours(t.audio_seconds)} h</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">{m.metrics.speed}</dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {worker.speed_rtf ?? "–"} <span className="text-sm font-normal text-zinc-500">{m.metrics.speedUnit}</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">{m.metrics.failures}</dt>
              <dd className={`text-2xl font-semibold tabular-nums ${worker.failure_rate > 0.1 ? "text-red-600" : ""}`}>{Math.round(worker.failure_rate * 100)} %</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-zinc-500">{fmt(m.metrics.runs, { done: t.completed, failed: t.failed, diar: t.diarize_only })}</p>
          {days.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-xs text-zinc-500">{m.metrics.last14}</div>
              <div className="flex h-20 items-end gap-1" role="img" aria-label={m.metrics.last14}>
                {days.map((d) => (
                  <div key={d.date} className="flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${hours(d.audio_seconds)} h · ${d.completed} ✓ ${d.failed} ✗`}>
                    <div className={`w-full rounded-t ${d.failed ? "bg-amber-400" : "bg-blue-500"}`} style={{ height: `${Math.max(2, (100 * d.audio_seconds) / max)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[10px] text-zinc-400">
                <span>{days[0].date.slice(5)}</span>
                <span>{days[days.length - 1].date.slice(5)}</span>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            {fmt(m.metrics.phases, { c: Math.round(worker.phase_rtf.CONVERTING ?? 0), t: Math.round(worker.phase_rtf.TRANSCRIBING ?? 0), d: Math.round(worker.phase_rtf.DIARIZING ?? 0) })}
          </p>
        </>
      )}
    </section>
  );
}

export function SettingsView({
  initial,
  storage,
  voices: initialVoices,
  metrics,
}: {
  initial: AppSettings;
  storage: StorageInfo;
  voices: Voice[];
  metrics: { library: LibraryStats; worker: WorkerMetrics | null };
}) {
  const { m } = useI18n();
  const toast = useToast();
  const fail = (err: unknown) => toast.error(fmt(m.toast.failed, { detail: (err as Error).message }));
  const [voices, setVoices] = useState(initialVoices);
  const [voiceDialog, setVoiceDialog] = useState<null | { kind: "rename"; voice: Voice } | { kind: "delete"; voice: Voice }>(null);
  const [voiceName, setVoiceName] = useState("");
  const renameVoice = async () => {
    if (voiceDialog?.kind !== "rename") return;
    const v = voiceDialog.voice;
    const name = voiceName.trim();
    setVoiceDialog(null);
    if (!name || name === v.name) return;
    try {
      await api(m, `/api/voices/${v.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      setVoices((vs) => vs.map((x) => (x.id === v.id ? { ...x, name } : x)));
      toast.success(m.toast.saved);
    } catch (err) {
      fail(err);
    }
  };
  const deleteVoice = async () => {
    if (voiceDialog?.kind !== "delete") return;
    const v = voiceDialog.voice;
    setVoiceDialog(null);
    try {
      await api(m, `/api/voices/${v.id}`, { method: "DELETE" });
      setVoices((vs) => vs.filter((x) => x.id !== v.id));
      toast.success(m.toast.deleted);
    } catch (err) {
      fail(err);
    }
  };
  const [glossary, setGlossary] = useState(initial.glossary);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");

  const save = async () => {
    setState("saving");
    try {
      setGlossary((await api<AppSettings>(m, "/api/settings", { method: "PUT", body: JSON.stringify({ glossary }) })).glossary);
      setState("saved");
      setTimeout(() => setState("idle"), 2000);
    } catch (err) {
      setState("idle");
      fail(err);
    }
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

      <MetricsSection library={metrics.library} worker={metrics.worker} />

      <section className="card p-5">
        <h2 className="font-semibold">{m.voices.title}</h2>
        <p className="mb-3 mt-1 text-sm text-zinc-500">{m.voices.help}</p>
        {voices.length === 0 ? (
          <p className="text-sm text-zinc-500">{m.voices.none}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" data-testid="voices">
            {voices.map((v) => (
              <li key={v.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="font-medium">{v.name}</span>
                <span className="text-xs text-zinc-500">{fmt(m.voices.samples, { n: v.samples })}</span>
                <span className="ml-auto flex gap-1">
                  <button
                    className="btn px-2 py-1 text-xs"
                    onClick={() => {
                      setVoiceName(v.name);
                      setVoiceDialog({ kind: "rename", voice: v });
                    }}
                  >
                    {m.voices.rename}
                  </button>
                  <button className="btn btn-danger px-2 py-1 text-xs" onClick={() => setVoiceDialog({ kind: "delete", voice: v })}>
                    {m.voices.delete}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={voiceDialog?.kind === "rename"}
        title={m.voices.renameTitle}
        onClose={() => setVoiceDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setVoiceDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-primary" onClick={renameVoice} disabled={!voiceName.trim()}>
              {m.settings.save}
            </button>
          </>
        }
      >
        <input className="input" value={voiceName} onChange={(e) => setVoiceName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && renameVoice()} aria-label={m.voices.renameTitle} />
      </Dialog>
      <Dialog
        open={voiceDialog?.kind === "delete"}
        title={m.voices.deleteTitle}
        onClose={() => setVoiceDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setVoiceDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-danger" onClick={deleteVoice}>
              {m.detail.confirm}
            </button>
          </>
        }
      >
        <p>{voiceDialog?.kind === "delete" ? fmt(m.voices.confirmDelete, { name: voiceDialog.voice.name }) : ""}</p>
      </Dialog>

      <section className="card p-5">
        <h2 className="font-semibold">{m.importDir.title}</h2>
        <p className="mt-1 text-sm text-zinc-500">{storage.importDir.enabled ? m.importDir.enabled : m.importDir.disabled}</p>
        {storage.importDir.path && (
          <p className="mt-2 text-sm">
            <code className="text-xs">{storage.importDir.path}</code>
            {storage.importDir.enabled && (
              <span className="ml-3 text-xs text-zinc-500">
                {fmt(m.importDir.pending, { n: storage.importDir.pending })} · {fmt(m.importDir.imported, { n: storage.importDir.imported })}
              </span>
            )}
          </p>
        )}
      </section>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">{m.settings.notifications}</h2>
        <NotificationsToggle full />
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
