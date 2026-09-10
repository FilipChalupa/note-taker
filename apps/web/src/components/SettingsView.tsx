"use client";

import { useState } from "react";
import type { AppSettings, StorageInfo, Voice } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { formatBytes } from "@/lib/format";
import { NotificationsToggle } from "./NotificationsToggle";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { api } from "@/lib/api-client";

export function SettingsView({ initial, storage, voices: initialVoices }: { initial: AppSettings; storage: StorageInfo; voices: Voice[] }) {
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
