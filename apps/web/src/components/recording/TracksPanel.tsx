"use client";

import { useEffect, useState } from "react";
import type { RecordingDetail, TrackInfo, TrackSpec } from "@note-taker/shared";
import { tracksToSpecs } from "@note-taker/shared";
import { speakerColor } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { Dialog } from "../Dialog";

const SPEAKER_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10];

export function trackTitle(t: Pick<TrackInfo, "index" | "name">, m: ReturnType<typeof useI18n>["m"]): string {
  return t.name?.trim() || fmt(m.tracks.track, { n: t.index + 1 });
}

/** Side panel section: the audio streams of a multi-track recording, what was used and who spoke on each. */
export function TracksSection({ rec, label, onEdit }: { rec: RecordingDetail; label: (id: string) => string; onEdit: () => void }) {
  const { m } = useI18n();
  if (!rec.tracks?.length) return null;
  return (
    <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800 print:hidden" data-testid="tracks">
      <h3 className="mb-2 text-sm font-semibold">{m.tracks.title}</h3>
      <ul className="space-y-2 text-xs">
        {rec.tracks.map((t) => (
          <li key={t.index} data-testid={`track-${t.index}`} className={t.used ? "" : "text-zinc-400 dark:text-zinc-500"}>
            <div className="flex justify-between gap-2">
              <span className="truncate font-medium">{trackTitle(t, m)}</span>
              <span className="shrink-0">
                {m.tracks.role[t.role]}
                {!t.used && t.role === "speech" ? ` · ${m.tracks.skipped}` : ""}
              </span>
            </div>
            {t.used && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-zinc-500">
                <span>{m.tracks.speakersOnTrack}</span>
                {t.speakers.length === 0 ? (
                  <span>{m.tracks.noSpeakers}</span>
                ) : (
                  t.speakers.map((id) => (
                    <span key={id} className="font-medium" style={{ color: speakerColor(id, rec.speakers).fg }}>
                      {label(id)}
                    </span>
                  ))
                )}
                {t.quality && <span>· {fmt(m.tracks.snr, { db: Math.round(t.quality.snr_db) })}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <button className="btn mt-3 py-1 text-xs" onClick={onEdit} disabled={rec.status !== "COMPLETED" && rec.status !== "FAILED"} data-testid="edit-tracks">
        {m.tracks.edit}
      </button>
    </div>
  );
}

/** Choose the tracks, their names and speaker counts, then transcribe again. `null` = automatic choice. */
export function TracksDialog({
  open,
  tracks,
  onClose,
  onSubmit,
  onSpeakersOnly,
}: {
  open: boolean;
  tracks: TrackInfo[] | null;
  onClose: () => void;
  onSubmit: (tracks: TrackSpec[] | null) => void;
  /** Same streams, new names / speaker counts: recompute speakers without transcribing again. */
  onSpeakersOnly: (tracks: TrackSpec[]) => void;
}) {
  const { m } = useI18n();
  const [draft, setDraft] = useState<TrackSpec[]>([]);
  useEffect(() => {
    if (open && tracks) setDraft(tracksToSpecs(tracks));
  }, [open, tracks]);
  if (!tracks) return null;

  const set = (index: number, change: Partial<TrackSpec>) => setDraft((d) => d.map((t) => (t.index === index ? { ...t, ...change } : t)));
  const noneUsed = !draft.some((t) => t.use);
  const sameStreams = draft.every((t) => (t.use !== false) === (tracks.find((x) => x.index === t.index)?.used ?? false));

  return (
    <Dialog
      open={open}
      title={m.tracks.editTitle}
      onClose={onClose}
      actions={
        <>
          <button className="btn mr-auto" onClick={() => onSubmit(null)} data-testid="tracks-automatic">
            {m.tracks.automatic}
          </button>
          <button className="btn" onClick={onClose}>
            {m.detail.cancel}
          </button>
          <button
            className="btn"
            disabled={noneUsed || !sameStreams}
            title={m.tracks.speakersOnlyHint}
            onClick={() => onSpeakersOnly(draft)}
            data-testid="tracks-speakers-only"
          >
            {m.tracks.speakersOnly}
          </button>
          <button className="btn btn-primary" disabled={noneUsed} onClick={() => onSubmit(draft)} data-testid="tracks-submit">
            {m.tracks.reprocess}
          </button>
        </>
      }
    >
      <p className="text-zinc-600 dark:text-zinc-300">{m.tracks.editText}</p>
      <div className="space-y-3">
        {draft.map((t) => {
          const info = tracks.find((x) => x.index === t.index)!;
          return (
            <div key={t.index} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800" data-testid={`track-edit-${t.index}`}>
              <div className="flex items-center justify-between gap-2 text-sm">
                <label className="flex items-center gap-2 font-medium">
                  <input type="checkbox" checked={t.use !== false} onChange={(e) => set(t.index, { use: e.target.checked })} />
                  {fmt(m.tracks.track, { n: t.index + 1 })}
                </label>
                <span className="text-xs text-zinc-500">
                  {m.tracks.role[info.role]}
                  {info.quality ? ` · ${fmt(m.tracks.snr, { db: Math.round(info.quality.snr_db) })}` : ""}
                </span>
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  className="input py-1 text-sm"
                  aria-label={m.tracks.name}
                  placeholder={m.tracks.namePlaceholder}
                  value={t.name ?? ""}
                  maxLength={60}
                  onChange={(e) => set(t.index, { name: e.target.value })}
                />
                <select
                  className="input w-28 shrink-0 py-1 text-sm"
                  aria-label={m.tracks.speakers}
                  title={m.tracks.speakers}
                  value={t.max_speakers ?? ""}
                  onChange={(e) => {
                    const n = e.target.value ? Number(e.target.value) : null;
                    // one person means exactly one; otherwise an upper bound and the diarizer decides
                    set(t.index, { max_speakers: n, min_speakers: n === 1 ? 1 : null });
                  }}
                >
                  <option value="">
                    {m.tracks.speakers}: {m.tracks.speakersAuto}
                  </option>
                  {SPEAKER_COUNTS.map((n) => (
                    <option key={n} value={n}>
                      {n === 1 ? "1" : `≤ ${n}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-zinc-500">{noneUsed ? m.tracks.noneUsed : m.tracks.note}</p>
    </Dialog>
  );
}
