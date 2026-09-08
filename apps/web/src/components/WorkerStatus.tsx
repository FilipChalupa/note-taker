"use client";

import { useEffect, useState } from "react";
import type { WorkerHealth } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

type Resp = { reachable: boolean; url: string; health?: WorkerHealth; error?: string };

export function WorkerStatus() {
  const { m } = useI18n();
  const [state, setState] = useState<Resp | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/worker/health", { cache: "no-store" });
        const j = (await r.json()) as Resp;
        if (alive) setState(j);
      } catch {
        if (alive) setState({ reachable: false, url: "" });
      }
    };
    void load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!state) return <span className="text-xs text-zinc-400">{m.worker.loading}</span>;

  if (!state.reachable) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400" title={state.error}>
        <span className="h-2 w-2 rounded-full bg-red-500" /> {m.worker.offline}
      </span>
    );
  }
  const h = state.health!;
  const gpu = h.cuda.available
    ? `${h.cuda.device_name} · ${h.cuda.vram_used_mb ?? "?"}/${h.cuda.vram_total_mb ?? "?"} MB VRAM`
    : m.worker.cpu;
  const queued = h.queue.pending + (h.queue.current_task_id ? 1 : 0);
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
      title={`${state.url}\n${gpu}\n${m.worker.model}: ${h.model} (${h.compute_type})\n${m.worker.diarization}: ${h.diarization_enabled ? m.worker.on : m.worker.off}`}
    >
      <span className={`h-2 w-2 rounded-full ${h.cuda.available ? "bg-emerald-500" : "bg-amber-500"}`} />
      {m.worker.online}
      {queued > 0 && (
        <span className="rounded bg-blue-100 px-1.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          {fmt(m.worker.inQueue, { n: queued })}
        </span>
      )}
    </span>
  );
}
