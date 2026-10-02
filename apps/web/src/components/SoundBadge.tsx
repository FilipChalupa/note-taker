"use client";

import type { AudioQualityIssue } from "@note-taker/shared";
import { useI18n } from "@/lib/i18n/client";

/** A small amber mark in the list for recordings whose sound likely hurt the transcript. */
export function SoundBadge({ issues }: { issues: AudioQualityIssue[] }) {
  const { m } = useI18n();
  if (issues.length === 0) return null;
  return (
    <span className="rounded bg-amber-100 px-1.5 text-[11px] text-amber-800 dark:bg-amber-900 dark:text-amber-200" title={issues.map((i) => m.quality.short[i]).join(", ")} data-testid="sound-badge">
      ♪ {issues.map((i) => m.quality.short[i]).join(", ")}
    </span>
  );
}
