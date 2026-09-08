"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat, RecordingDetail } from "@note-taker/shared";
import { StatusBadge } from "./StatusBadge";
import { PlayerControls } from "./player/PlayerControls";
import { usePlayer } from "./player/PlayerProvider";
import { errorLabel, formatDate, formatDuration, formatTime, groupTurns, phaseLabel, speakerColor, speakerLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 2500;
const EXPORTS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

export function RecordingView({ initial }: { initial: RecordingDetail }) {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [rec, setRec] = useState(initial);
  const inflight = rec.status === "QUEUED" || rec.status === "PROCESSING";

  // ---------------------------------------------------------------- polling
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/recordings/${initial.id}`, { cache: "no-store" });
    if (r.status === 404) {
      router.push("/");
      return;
    }
    if (r.ok) setRec((await r.json()) as RecordingDetail);
  }, [initial.id, router]);

  useEffect(() => {
    if (!inflight) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [inflight, refresh]);

  // ---------------------------------------------------------------- player
  // The <audio> element lives in the global PlayerProvider so playback survives navigation.
  const player = usePlayer();
  const isCurrent = player.track?.id === rec.id;
  const playing = isCurrent && player.playing;
  const time = isCurrent ? player.time : 0;
  const duration = isCurrent && player.duration ? player.duration : (rec.durationSec ?? 0);
  const [follow, setFollow] = useState(true);

  const track = useMemo(
    () => (rec.audioUrl ? { id: rec.id, title: rec.title, src: rec.audioUrl, duration: rec.durationSec } : null),
    [rec.id, rec.title, rec.audioUrl, rec.durationSec],
  );

  const seekTo = useCallback(
    (t: number, play = false) => {
      if (!track) return;
      if (isCurrent) {
        player.seek(t);
        if (play) player.play();
      } else {
        player.load(track, { startAt: t, autoplay: play });
      }
    },
    [track, isCurrent, player],
  );

  const toggle = useCallback(() => {
    if (!track) return;
    if (isCurrent) player.toggle();
    else player.load(track, { autoplay: true });
  }, [track, isCurrent, player]);

  const skip = useCallback(
    (delta: number) => {
      if (isCurrent) player.skip(delta);
      else seekTo(Math.max(0, delta), false);
    },
    [isCurrent, player, seekTo],
  );

  // Keep the global bar's title in sync when the recording is renamed
  useEffect(() => {
    if (isCurrent && track && player.track?.title !== track.title) player.load(track);
  }, [isCurrent, track, player]);

  // -------------------------------------------------------------- transcript
  const turns = useMemo(() => groupTurns(rec.segments), [rec.segments]);
  const activeIndex = useMemo(() => {
    const segs = rec.segments;
    if (segs.length === 0) return -1;
    // binary search for last segment with start <= time
    let lo = 0;
    let hi = segs.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].start <= time) {
        idx = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return idx >= 0 && time <= segs[idx].end + 0.6 ? idx : -1;
  }, [rec.segments, time]);

  const activeRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!follow || !playing || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, follow, playing]);

  // ---------------------------------------------------------------- editing
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(rec.title);
  const [names, setNames] = useState<Record<string, string>>(rec.speakerNames);
  const [saving, setSaving] = useState(false);

  useEffect(() => setNames(rec.speakerNames), [rec.speakerNames]);

  const patch = async (body: { title?: string; speakerNames?: Record<string, string> }) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/recordings/${rec.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) setRec((await r.json()) as RecordingDetail);
    } finally {
      setSaving(false);
    }
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== rec.title) await patch({ title: titleDraft });
  };

  const saveNames = async () => {
    if (JSON.stringify(names) !== JSON.stringify(rec.speakerNames)) await patch({ speakerNames: names });
  };

  const remove = async () => {
    if (!confirm(fmt(m.list.confirmDelete, { title: rec.title }))) return;
    const r = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
    if (r.ok) router.push("/");
  };

  const retry = async () => {
    const r = await fetch(`/api/recordings/${rec.id}/retry`, { method: "POST" });
    if (r.ok) setRec((await r.json()) as RecordingDetail);
  };

  const label = (id: string) => speakerLabel(id, rec.speakers, names, m);
  const langLabel = (m.languages as Record<string, string>)[rec.language] ?? rec.language;
  const phase = phaseLabel(rec.phase, m);
  const err = errorLabel(rec.error, m);

  // ------------------------------------------------------------------ render
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Link href="/" className="text-sm text-zinc-500 hover:underline">
            {m.detail.back}
          </Link>
          {editingTitle ? (
            <input
              autoFocus
              className="input mt-1 text-xl font-semibold"
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveTitle();
                if (e.key === "Escape") {
                  setTitleDraft(rec.title);
                  setEditingTitle(false);
                }
              }}
            />
          ) : (
            <h1
              className="mt-1 cursor-text truncate text-2xl font-semibold hover:opacity-80"
              title={m.detail.renameHint}
              onClick={() => {
                setTitleDraft(rec.title);
                setEditingTitle(true);
              }}
            >
              {rec.title}
            </h1>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
            <StatusBadge status={rec.status} title={phase} progress={rec.progress} />
            <span>{formatDate(rec.createdAt, locale)}</span>
            <span>{formatDuration(rec.durationSec, m)}</span>
            <span>{langLabel}</span>
            {rec.speakerCount != null && <span>{fmt(m.detail.speakersCount, { n: rec.speakerCount })}</span>}
            <span className="truncate" title={rec.originalFilename}>
              {rec.originalFilename}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rec.status === "COMPLETED" && (
            <div className="flex items-center gap-1">
              <span className="mr-1 text-xs text-zinc-500">{m.detail.export}</span>
              {EXPORTS.map((f) => (
                <a key={f} className="btn" href={`/api/recordings/${rec.id}/export?format=${f}`}>
                  {m.detail.exportFormats[f]}
                </a>
              ))}
            </div>
          )}
          {rec.audioUrl && (
            <a className="btn" href={`${rec.audioUrl}?download=1`} download title={m.detail.downloadAudioHint}>
              ⬇ {m.detail.downloadAudio}
            </a>
          )}
          {rec.status === "FAILED" && (
            <button className="btn" onClick={retry}>
              {m.detail.retry}
            </button>
          )}
          <button className="btn btn-danger" onClick={remove}>
            {m.detail.delete}
          </button>
        </div>
      </div>

      {inflight && (
        <div className="card p-5">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">{phase ?? m.detail.processing}</span>
            <span className="text-zinc-500">{rec.progress} %</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${rec.progress}%` }} />
          </div>
          {err && <p className="mt-2 text-xs text-amber-600">{err}</p>}
          <p className="mt-3 text-xs text-zinc-500">
            {m.detail.autoRefresh}
          </p>
        </div>
      )}

      {rec.status === "FAILED" && (
        <div className="card border-red-300 p-5 dark:border-red-800">
          <div className="font-medium text-red-700 dark:text-red-300">{m.detail.failed}</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</pre>
        </div>
      )}

      {rec.audioUrl && (
        <div className="card sticky top-2 z-10 p-4">
          <PlayerControls
            playing={playing}
            time={time}
            duration={duration}
            rate={player.rate}
            onToggle={toggle}
            onSkip={skip}
            onSeek={(t) => seekTo(t)}
            onRate={player.setRate}
          />
        </div>
      )}

      {rec.status === "COMPLETED" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <section className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold">{m.detail.transcript}</h2>
              <label className="flex items-center gap-1.5 text-xs text-zinc-500">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                {m.detail.follow}
              </label>
            </div>
            {turns.length === 0 ? (
              <p className="text-sm text-zinc-500">{m.detail.noSpeech}</p>
            ) : (
              <div className="space-y-4">
                {turns.map((turn, ti) => {
                  const c = speakerColor(turn.speaker, rec.speakers);
                  return (
                    <div key={ti} className="rounded-md border-l-4 pl-3" style={{ borderColor: c.border, background: c.bg }}>
                      <div className="flex items-baseline gap-2 pt-1.5">
                        <span className="text-sm font-semibold" style={{ color: c.fg }}>
                          {label(turn.speaker)}
                        </span>
                        <button
                          className="font-mono text-xs text-zinc-500 hover:underline"
                          onClick={() => seekTo(turn.start, true)}
                        >
                          {formatTime(turn.start)}
                        </button>
                      </div>
                      <p className="pb-2 pt-0.5 text-[15px] leading-relaxed">
                        {turn.segments.map((seg) => {
                          const active = seg.index === activeIndex;
                          return (
                            <span
                              key={seg.index}
                              ref={active ? activeRef : undefined}
                              onClick={() => seekTo(seg.start, true)}
                              title={`${formatTime(seg.start)} – ${formatTime(seg.end)}`}
                              className={`cursor-pointer rounded px-0.5 transition ${
                                active ? "bg-yellow-200 dark:bg-yellow-700/60" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-700/50"
                              }`}
                            >
                              {seg.text}{" "}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <aside className="card h-fit p-5 lg:sticky lg:top-40">
            <h2 className="mb-3 font-semibold">{m.detail.speakers}</h2>
            {rec.speakers.length === 0 ? (
              <p className="text-sm text-zinc-500">{m.detail.noSpeakers}</p>
            ) : (
              <div className="space-y-2">
                {rec.speakers.map((id) => {
                  const c = speakerColor(id, rec.speakers);
                  return (
                    <div key={id} className="flex items-center gap-2">
                      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: c.fg }} />
                      <input
                        className="input py-1"
                        value={names[id] ?? ""}
                        placeholder={label(id)}
                        onChange={(e) => setNames((n) => ({ ...n, [id]: e.target.value }))}
                        onBlur={saveNames}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                    </div>
                  );
                })}
                <p className="pt-1 text-xs text-zinc-500">
                  {saving ? m.detail.saving : m.detail.renameNote}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
