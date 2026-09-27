"use client";

import { useState } from "react";
import type { RecordingDetail, SpeakerStats } from "@note-taker/shared";
import { formatTime, speakerColor } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

/** Side panel: speaker names, voice suggestions, merging, talk-time stats and re-transcription hints. */
export function SpeakersPanel({
  rec,
  names,
  label,
  stats,
  saving,
  onNameChange,
  onNamesCommit,
  onApplySuggestions,
  onMerge,
  onSaveHints,
}: {
  rec: RecordingDetail;
  names: Record<string, string>;
  label: (id: string) => string;
  stats: SpeakerStats;
  saving: boolean;
  onNameChange: (id: string, name: string) => void;
  onNamesCommit: () => void;
  onApplySuggestions: (speakers?: string[]) => void;
  onMerge: (from: string, into: string) => void;
  onSaveHints: (hints: string) => void;
}) {
  const { m } = useI18n();
  const [hintsDraft, setHintsDraft] = useState(rec.hints ?? "");

  return (
    <aside className="card h-fit p-5 lg:sticky lg:top-40 print:static print:break-inside-avoid" data-print="aside">
      <h2 className="mb-3 font-semibold">{m.detail.speakers}</h2>
      {Object.keys(rec.speakerSuggestions).some((id) => !names[id]) && (
        <button className="btn mb-3 w-full justify-center py-1 text-xs" onClick={() => onApplySuggestions()} data-testid="apply-all-suggestions">
          ✨ {m.voices.applyAll}
        </button>
      )}
      {rec.speakers.length === 0 ? (
        <p className="text-sm text-zinc-500">{m.detail.noSpeakers}</p>
      ) : (
        <div className="space-y-2">
          {rec.speakers.map((id) => {
            const c = speakerColor(id, rec.speakers);
            const suggestion = rec.speakerSuggestions[id];
            return (
              <div key={id} className="flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.fg }} />
                <input
                  className="input py-1"
                  value={names[id] ?? ""}
                  placeholder={label(id)}
                  onChange={(e) => onNameChange(id, e.target.value)}
                  onBlur={onNamesCommit}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                {suggestion && !names[id] && (
                  <button
                    className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                    title={`${fmt(m.voices.looksLike, { name: suggestion.name })} · ${Math.round(suggestion.score * 100)} % · ${suggestion.score >= 0.7 ? m.voices.strong : m.voices.weak}`}
                    onClick={() => onApplySuggestions([id])}
                    data-testid={`suggestion-${id}`}
                  >
                    ✨ {suggestion.name} {Math.round(suggestion.score * 100)} %
                  </button>
                )}
                {rec.speakers.length > 1 && (
                  <select
                    className="w-8 shrink-0 rounded border border-zinc-300 bg-white py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                    title={m.detail.mergeInto}
                    aria-label={`${m.detail.mergeInto} ${label(id)}`}
                    value=""
                    onChange={(e) => onMerge(id, e.target.value)}
                  >
                    <option value="">⇄</option>
                    {rec.speakers
                      .filter((other) => other !== id)
                      .map((other) => (
                        <option key={other} value={other}>
                          → {label(other)}
                        </option>
                      ))}
                  </select>
                )}
              </div>
            );
          })}
          <p className="pt-1 text-xs text-zinc-500 print:hidden">
            {saving ? m.detail.saving : rec.speakersWithEmbedding.length > 0 ? `${m.detail.renameNote} ${m.voices.help}` : m.detail.renameNote}
          </p>
        </div>
      )}
      {stats.rows.length > 0 && (
        <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800" data-testid="speaker-stats">
          <h3 className="mb-2 text-sm font-semibold">{m.stats.title}</h3>
          <div className="space-y-2">
            {stats.rows.map((r) => {
              const c = speakerColor(r.speaker, rec.speakers);
              return (
                <div key={r.speaker} className="text-xs">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium" style={{ color: c.fg }}>
                      {label(r.speaker)}
                    </span>
                    <span className="shrink-0 tabular-nums text-zinc-500">
                      {Math.round(r.share * 100)} % · {formatTime(r.seconds)} · {r.turns} {m.stats.turns} · {r.words} {m.stats.words}
                    </span>
                  </div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                    <div className="h-full" style={{ width: `${Math.max(2, r.share * 100)}%`, background: c.fg }} />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-zinc-500">
              {fmt(m.stats.totalTurns, { n: stats.speakerChanges })} · {fmt(m.stats.longest, { d: formatTime(stats.longestTurnSeconds) })}
            </p>
          </div>
        </div>
      )}
      <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800 print:hidden">
        <h3 className="mb-1 text-sm font-semibold">{m.detail.hintsTitle}</h3>
        <textarea className="input min-h-[64px] text-sm" value={hintsDraft} onChange={(e) => setHintsDraft(e.target.value)} placeholder={m.upload.hintsPlaceholder} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn py-1 text-xs" disabled={hintsDraft === (rec.hints ?? "")} onClick={() => onSaveHints(hintsDraft)}>
            {m.detail.hintsSave}
          </button>
          <span className="text-xs text-zinc-500">{m.detail.hintsNote}</span>
        </div>
      </div>
    </aside>
  );
}
