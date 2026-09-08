"use client";

import type { RecordingStatus } from "@note-taker/shared";
import { useI18n } from "@/lib/i18n/client";

const STYLES: Record<RecordingStatus, string> = {
  QUEUED: "bg-zinc-100 text-zinc-700 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  PROCESSING: "bg-blue-50 text-blue-700 ring-blue-300 dark:bg-blue-950 dark:text-blue-300 dark:ring-blue-800 animate-pulse-soft",
  COMPLETED: "bg-emerald-50 text-emerald-700 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800",
  FAILED: "bg-red-50 text-red-700 ring-red-300 dark:bg-red-950 dark:text-red-300 dark:ring-red-800",
};

export function StatusBadge({ status, title, progress }: { status: RecordingStatus; title?: string | null; progress?: number }) {
  const { m } = useI18n();
  const label = m.status[status] ?? status;
  const detail = status === "PROCESSING" && progress != null ? `${label} · ${progress} %` : label;
  return (
    <span
      title={title ?? undefined}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}
    >
      {detail}
    </span>
  );
}
