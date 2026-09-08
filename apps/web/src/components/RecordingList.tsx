"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { RecordingSummary } from "@note-taker/shared";
import { StatusBadge } from "./StatusBadge";
import { formatDate, formatDuration } from "@/lib/format";

const POLL_MS = 3000;

export function RecordingList({ initial }: { initial: RecordingSummary[] }) {
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
    if (!confirm(`Smazat nahrávku „${rec.title}“ včetně přepisu?`)) return;
    const r = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
    if (r.ok) setItems((xs) => xs.filter((x) => x.id !== rec.id));
  };

  const retry = async (rec: RecordingSummary) => {
    await fetch(`/api/recordings/${rec.id}/retry`, { method: "POST" });
    void refresh();
  };

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Nahrávky</h1>
        <Link href="/upload" className="btn btn-primary">
          + Nahrát schůzku
        </Link>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">Nepodařilo se načíst seznam: {error}</p>}

      {items.length === 0 ? (
        <div className="card p-10 text-center text-zinc-500">
          Zatím žádné nahrávky.{" "}
          <Link href="/upload" className="text-blue-600 underline">
            Nahrajte první schůzku
          </Link>
          .
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60">
              <tr>
                <th className="px-4 py-2">Název</th>
                <th className="px-4 py-2">Datum</th>
                <th className="px-4 py-2">Délka</th>
                <th className="px-4 py-2">Mluvčí</th>
                <th className="px-4 py-2">Stav</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {items.map((rec) => (
                <tr key={rec.id} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/recordings/${rec.id}`} className="font-medium hover:underline">
                      {rec.title}
                    </Link>
                    <div className="text-xs text-zinc-500">{rec.originalFilename}</div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(rec.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5">{formatDuration(rec.durationSec)}</td>
                  <td className="px-4 py-2.5">{rec.speakerCount ?? "–"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-col gap-1">
                      <StatusBadge status={rec.status} phase={rec.phase} progress={rec.progress} />
                      {(rec.status === "PROCESSING" || rec.status === "QUEUED") && (
                        <div className="text-xs text-zinc-500">{rec.phase}</div>
                      )}
                      {rec.status === "PROCESSING" && (
                        <div className="h-1 w-32 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                          <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
                        </div>
                      )}
                      {rec.status === "FAILED" && rec.error && (
                        <div className="max-w-xs truncate text-xs text-red-600" title={rec.error}>
                          {rec.error}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {rec.status === "FAILED" && (
                      <button className="btn mr-2" onClick={() => retry(rec)}>
                        Zkusit znovu
                      </button>
                    )}
                    <button className="btn btn-danger" onClick={() => remove(rec)}>
                      Smazat
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
