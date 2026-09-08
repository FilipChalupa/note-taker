"use client";

import { useEffect, useState } from "react";
import type { WorkerHealth } from "@note-taker/shared";

type Resp = { reachable: boolean; url: string; health?: WorkerHealth; error?: string };

export function WorkerStatus() {
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

  if (!state) return <span className="text-xs text-zinc-400">Worker: …</span>;

  if (!state.reachable) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400" title={state.error}>
        <span className="h-2 w-2 rounded-full bg-red-500" /> Worker offline
      </span>
    );
  }
  const h = state.health!;
  const gpu = h.cuda.available
    ? `${h.cuda.device_name} · ${h.cuda.vram_used_mb ?? "?"}/${h.cuda.vram_total_mb ?? "?"} MB VRAM`
    : "CPU (CUDA nedostupná)";
  return (
    <span
      className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400"
      title={`${state.url}\n${gpu}\nModel: ${h.model} (${h.compute_type})\nDiarizace: ${h.diarization_enabled ? "zapnuta" : "vypnuta"}`}
    >
      <span className={`h-2 w-2 rounded-full ${h.cuda.available ? "bg-emerald-500" : "bg-amber-500"}`} />
      Worker online
      {h.queue.pending + (h.queue.current_task_id ? 1 : 0) > 0 && (
        <span className="rounded bg-blue-100 px-1.5 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          {h.queue.pending + (h.queue.current_task_id ? 1 : 0)} ve frontě
        </span>
      )}
    </span>
  );
}
