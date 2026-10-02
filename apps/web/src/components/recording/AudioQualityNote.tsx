"use client";

import { audioQualityIssues, type AudioQuality } from "@note-taker/shared";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const round = (v: number) => String(Math.round(v));

function useDetails(q: AudioQuality): string {
  const { m } = useI18n();
  return fmt(m.quality.details, { speech: round(q.speech_db), noise: round(q.noise_db), share: round(q.speech_share * 100) });
}

/** One quiet entry for the metadata line: the speech-to-noise margin, the measured levels on hover. */
export function AudioQualityBadge({ quality }: { quality: AudioQuality }) {
  const { m } = useI18n();
  const details = useDetails(quality);
  const issues = audioQualityIssues(quality);
  return (
    <span className={issues.length ? "text-amber-700 dark:text-amber-300" : undefined} title={details} data-testid="audio-quality">
      {fmt(m.quality.margin, { snr: round(quality.snr_db) })}
    </span>
  );
}

/** Shown above the transcript only when the sound itself is a likely cause of mistakes. */
export function AudioQualityWarning({ quality }: { quality: AudioQuality }) {
  const { m } = useI18n();
  const details = useDetails(quality);
  const issues = audioQualityIssues(quality);
  if (issues.length === 0) return null;
  const params = { snr: round(quality.snr_db), speech: round(quality.speech_db), pct: (quality.clipped_share * 100).toFixed(1) };
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 print:hidden dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" data-testid="audio-quality-warning">
      <div className="font-medium">⚠ {m.quality.title}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5">
        {issues.map((issue) => (
          <li key={issue}>{fmt(m.quality[issue], params)}</li>
        ))}
      </ul>
      <div className="mt-1 text-xs opacity-80">
        {m.quality.hint} {details}
      </div>
    </div>
  );
}
