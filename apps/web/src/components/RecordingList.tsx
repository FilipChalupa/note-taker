"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { RecordingSummary } from "@note-taker/shared";
import { StatusBadge } from "./StatusBadge";
import { requestWorkerRefresh } from "./WorkerStatus";
import { errorLabel, formatDate, formatDuration, phaseLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 3000;

export function RecordingList({ initial }: { initial: RecordingSummary[] }) {
  const { locale, m } = useI18n();
  const [items, setItems] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/recordings", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setItems((await r.json()) as RecordingSummary[]);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const inflight = items.some((r) => r.status === "QUEUED" || r.status === "PROCESSING");
  useEffect(() => {
    if (!inflight) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [inflight, refresh]);

  const remove = async (rec: RecordingSummary) => {
    if (!confirm(fmt(m.list.confirmDelete, { title: rec.title }))) return;
    const r = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
    if (r.ok) setItems((xs) => xs.filter((x) => x.id !== rec.id));
  };

  const retry = async (rec: RecordingSummary) => {
    await fetch(`/api/recordings/${rec.id}/retry`, { method: "POST" });
    requestWorkerRefresh();
    void refresh();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.list.title}</h1>
        <Link href="/upload" className="btn btn-primary">
          {m.list.upload}
        </Link>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{fmt(m.errors.LIST_FAILED, { msg: error })}</p>}

      {items.length === 0 ? (
        <div className="card p-10 text-center text-zinc-500">
          {m.list.empty}{" "}
          <Link href="/upload" className="text-blue-600 underline">
            {m.list.emptyCta}
          </Link>
          .
        </div>
      ) : (
        <>
        <div className="space-y-2 md:hidden">
          {items.map((rec) => {
            const phase = phaseLabel(rec.phase, m);
            const err = errorLabel(rec.error, m);
            return (
              <div key={rec.id} className="card p-3">
                <Link href={`/recordings/${rec.id}`} className="block font-medium hover:underline">
                  {rec.title}
                </Link>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                  <span>{formatDate(rec.createdAt, locale)}</span>
                  {rec.durationSec != null && <span>{formatDuration(rec.durationSec, m)}</span>}
                  {rec.speakerCount != null && <span>{rec.speakerCount} {m.list.speakers.toLowerCase()}</span>}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <StatusBadge status={rec.status} title={phase} progress={rec.progress} />
                    {(rec.status === "PROCESSING" || rec.status === "QUEUED") && phase && <div className="mt-1 text-xs text-zinc-500">{phase}</div>}
                    {rec.status === "FAILED" && err && (
                      <div className="mt-1 truncate text-xs text-red-600" title={err}>
                        {err}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {rec.status === "FAILED" && (
                      <button className="btn px-2 py-1 text-xs" onClick={() => retry(rec)}>
                        {m.list.retry}
                      </button>
                    )}
                    <button className="btn btn-danger px-2 py-1 text-xs" onClick={() => remove(rec)}>
                      {m.list.delete}
                    </button>
                  </div>
                </div>
                {rec.status === "PROCESSING" && (
                  <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                    <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="card hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60">
              <tr>
                <th className="px-4 py-2">{m.list.name}</th>
                <th className="px-4 py-2">{m.list.date}</th>
                <th className="px-4 py-2">{m.list.duration}</th>
                <th className="px-4 py-2">{m.list.speakers}</th>
                <th className="px-4 py-2">{m.list.state}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {items.map((rec) => {
                const phase = phaseLabel(rec.phase, m);
                const err = errorLabel(rec.error, m);
                return (
                  <tr key={rec.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                    <td className="px-4 py-2.5">
                      <Link href={`/recordings/${rec.id}`} className="font-medium hover:underline">
                        {rec.title}
                      </Link>
                      <div className="text-xs text-zinc-500">{rec.originalFilename}</div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(rec.createdAt, locale)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5">{formatDuration(rec.durationSec, m)}</td>
                    <td className="px-4 py-2.5">{rec.speakerCount ?? "–"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={rec.status} title={phase} progress={rec.progress} />
                        {(rec.status === "PROCESSING" || rec.status === "QUEUED") && phase && (
                          <div className="text-xs text-zinc-500">{phase}</div>
                        )}
                        {rec.status === "PROCESSING" && (
                          <div className="h-1 w-32 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                            <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
                          </div>
                        )}
                        {rec.status === "FAILED" && err && (
                          <div className="max-w-xs truncate text-xs text-red-600" title={err}>
                            {err}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">
                      {rec.status === "FAILED" && (
                        <button className="btn mr-2" onClick={() => retry(rec)}>
                          {m.list.retry}
                        </button>
                      )}
                      <button className="btn btn-danger" onClick={() => remove(rec)}>
                        {m.list.delete}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
