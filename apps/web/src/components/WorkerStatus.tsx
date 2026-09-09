"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { WorkerHealth } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

type Resp = { reachable: boolean; url: string; health?: WorkerHealth; error?: string };

export const WORKER_REFRESH_EVENT = "note-taker:worker-refresh";
/** Ask the header worker/queue chip to refresh right away (after upload, retry, rediarize...). */
export function requestWorkerRefresh(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKER_REFRESH_EVENT));
}

/** Short GPU name: "NVIDIA GeForce RTX 3080" -> "RTX 3080" */
function shortGpuName(name: string | null): string {
  if (!name) return "";
  return name.replace(/^NVIDIA\s+/i, "").replace(/^GeForce\s+/i, "").trim();
}

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
    const t = setInterval(load, 5_000);
    // Refresh immediately after actions that change the queue (upload, retry, rediarize) and on tab focus
    const onRefresh = () => void load();
    const onVisible = () => document.visibilityState === "visible" && void load();
    window.addEventListener(WORKER_REFRESH_EVENT, onRefresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener(WORKER_REFRESH_EVENT, onRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (!state) return <span className="text-xs text-zinc-400">{m.worker.loading}</span>;

  if (!state.reachable) {
    return (
      <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-red-600 dark:text-red-400" title={state.error}>
        <span className="h-2 w-2 rounded-full bg-red-500" /> <span className="hidden sm:inline">{m.worker.offline}</span>
      </span>
    );
  }
  const h = state.health!;
  const c = h.cuda;
  const usedMb = c.memory_used_mb ?? c.vram_used_mb;
  const gb = (mb: number | null) => (mb == null ? "?" : (mb / 1024).toFixed(1));
  const gpuDetail = c.available
    ? [
        c.device_name,
        c.utilization_pct != null ? `${m.gpu.util} ${c.utilization_pct} %` : null,
        `${m.gpu.vram} ${gb(usedMb)}/${gb(c.vram_total_mb)} GB`,
        c.temperature_c != null ? `${m.gpu.temp} ${c.temperature_c} °C` : null,
        c.power_w != null ? `${m.gpu.power} ${c.power_w} W` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : m.worker.cpu;
  const hot = c.temperature_c != null && c.temperature_c >= 80;
  const queued = h.queue.pending + (h.queue.current_task_id ? 1 : 0);
  const diarizationLine = h.diarization_error
    ? fmt(m.worker.diarizationFailed, { detail: h.diarization_error })
    : `${m.worker.diarization}: ${h.diarization_enabled ? m.worker.on : m.worker.off}`;
  const tooltip = `${state.url}\n${gpuDetail}\n${m.worker.model}: ${h.model} (${h.compute_type})\n${diarizationLine}`;

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-zinc-600 dark:text-zinc-400 sm:gap-2" title={tooltip}>
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${h.diarization_error ? "bg-amber-500" : "bg-emerald-500"}`} />
        <span className="hidden sm:inline">{m.worker.online}</span>
      </span>
      {c.available ? (
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium tabular-nums ring-1 ring-inset ${
            hot
              ? "bg-red-50 text-red-700 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800"
              : "bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800"
          }`}
        >
          ⚡ {m.worker.gpu}
          {c.utilization_pct != null && <span className="font-normal">{c.utilization_pct} %</span>}
          <span className="hidden font-normal md:inline">
            · {gb(usedMb)}/{gb(c.vram_total_mb)} GB
            {c.temperature_c != null && <> · {c.temperature_c} °C</>}
          </span>
          <span className="hidden font-normal xl:inline">· {shortGpuName(c.device_name)}</span>
        </span>
      ) : (
        <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 ring-1 ring-inset ring-amber-300 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800">
          {m.worker.cpuChip}
        </span>
      )}
      <Link
        href="/queue"
        className={
          queued > 0
            ? "rounded bg-blue-100 px-1.5 py-0.5 text-blue-800 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:hover:bg-blue-800"
            : "rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        }
      >
        <span className="sm:hidden">⏳ {queued}</span>
        <span className="hidden sm:inline">{queued > 0 ? fmt(m.worker.inQueue, { n: queued }) : m.worker.queueEmpty}</span>
      </Link>
    </span>
  );
}
