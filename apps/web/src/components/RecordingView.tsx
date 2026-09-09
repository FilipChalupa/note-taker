"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExportFormat, RecordingDetail, SegmentEdit } from "@note-taker/shared";
import { StatusBadge } from "./StatusBadge";
import { Dialog } from "./Dialog";
import { requestWorkerRefresh } from "./WorkerStatus";
import { PlayerControls } from "./player/PlayerControls";
import { usePlayer } from "./player/PlayerProvider";
import { errorLabel, formatDate, formatDuration, formatTime, groupTurns, phaseLabel, speakerColor, speakerLabel, warningLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 2500;

/** Wrap search matches in <mark>; `counter.n` is the running global match index, the one equal to
 *  `cursor` gets the ref for scrolling. */
function highlightMatches(
  text: string,
  matcher: RegExp,
  counter: { n: number },
  cursor: number,
  cursorRef: React.RefObject<HTMLSpanElement | null>,
): React.ReactNode {
  const parts = text.split(matcher);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const idx = counter.n++;
    return (
      <mark
        key={i}
        ref={idx === cursor ? (cursorRef as React.RefObject<HTMLElement>) : undefined}
        className={`rounded px-0.5 ${idx === cursor ? "bg-orange-300 dark:bg-orange-600" : "bg-yellow-200 dark:bg-yellow-700/60"}`}
      >
        {part}
      </mark>
    );
  });
}
const EXPORTS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

export function RecordingView({ initial }: { initial: RecordingDetail }) {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [rec, setRec] = useState(initial);
  const inflight = rec.status === "QUEUED" || rec.status === "PROCESSING";
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();

  // ---------------------------------------------------------------- polling
  const refresh = useCallback(async () => {
    const r = await fetch(`/api/recordings/${initial.id}`, { cache: "no-store" });
    if (r.status === 404) {
      router.push("/");
      return;
    }
    if (r.ok) {
      const next = (await r.json()) as RecordingDetail;
      setRec((prev) => {
        if (prev.status !== next.status || prev.workerStatus !== next.workerStatus) requestWorkerRefresh();
        return next;
      });
    }
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

  const activeWord = useMemo(() => {
    if (activeIndex < 0) return -1;
    const words = rec.segments[activeIndex]?.words;
    if (!words?.length) return -1;
    let idx = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w.start != null && w.start <= time) idx = i;
    }
    return idx;
  }, [rec.segments, activeIndex, time]);

  const matcher = useMemo(() => {
    if (!query) return null;
    const terms = query.split(/\s+/).filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return terms.length ? new RegExp(`(${terms.join("|")})`, "giu") : null;
  }, [query]);
  const matchCount = useMemo(() => {
    if (!matcher) return 0;
    return rec.segments.reduce((n, s) => n + (s.text.match(matcher)?.length ?? 0), 0);
  }, [matcher, rec.segments]);
  const matchOffsets = useMemo(() => {
    const map = new Map<number, number>();
    if (!matcher) return map;
    let n = 0;
    rec.segments.forEach((seg, i) => {
      map.set(i, n);
      n += seg.text.match(matcher)?.length ?? 0;
    });
    return map;
  }, [matcher, rec.segments]);
  const [matchCursor, setMatchCursor] = useState(0);
  const matchRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    matchRef.current?.scrollIntoView({ block: "center" });
  }, [matchCursor, matchCount]);

  const activeRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!follow || !playing || !activeRef.current) return;
    activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, follow, playing]);

  // ---------------------------------------------------------------- editing
  type Snapshot = Pick<RecordingDetail, "segments" | "speakers" | "speakerNames">;
  const [history, setHistory] = useState<Snapshot[]>([]);
  const pushHistory = (r: RecordingDetail) =>
    setHistory((h) => [...h.slice(-49), { segments: r.segments, speakers: r.speakers, speakerNames: r.speakerNames }]);
  type DialogState =
    | null
    | { kind: "rediarize" }
    | { kind: "confirm"; title: string; text: string; danger?: boolean; onConfirm: () => void }
    | { kind: "shortcuts" };
  const [dialog, setDialog] = useState<DialogState>(null);
  const [rediarizeMode, setRediarizeMode] = useState<"auto" | "exact" | "range">("auto");
  const [rediarizeCount, setRediarizeCount] = useState("");
  const [rediarizeMin, setRediarizeMin] = useState("");
  const [rediarizeMax, setRediarizeMax] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [hintsDraft, setHintsDraft] = useState(rec.hints ?? "");
  const [tagsDraft, setTagsDraft] = useState(rec.tags.join(", "));
  const [notesDraft, setNotesDraft] = useState(rec.notes ?? "");
  const [notesSaved, setNotesSaved] = useState(false);
  useEffect(() => setTagsDraft(rec.tags.join(", ")), [rec.tags]);
  useEffect(() => setNotesDraft(rec.notes ?? ""), [rec.notes]);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(rec.title);
  const [names, setNames] = useState<Record<string, string>>(rec.speakerNames);
  const [saving, setSaving] = useState(false);

  useEffect(() => setNames(rec.speakerNames), [rec.speakerNames]);

  const applySuggestions = async (speakers?: string[]) => {
    setSaving(true);
    try {
      const r = await fetch(`/api/recordings/${rec.id}/speakers/apply-suggestions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ speakers }),
      });
      if (r.ok) {
        const next = (await r.json()) as RecordingDetail;
        setRec(next);
        setNames(next.speakerNames);
      }
    } finally {
      setSaving(false);
    }
  };

  const saveNotes = async () => {
    if (notesDraft === (rec.notes ?? "")) return;
    await patch({ notes: notesDraft });
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 1500);
  };

  const patch = async (body: { title?: string; speakerNames?: Record<string, string>; hints?: string | null; tags?: string; notes?: string | null }) => {
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

  const applyEdits = async (edits: SegmentEdit[]) => {
    pushHistory(rec);
    setSaving(true);
    try {
      const r = await fetch(`/api/recordings/${rec.id}/segments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ edits }),
      });
      if (r.ok) setRec((await r.json()) as RecordingDetail);
    } finally {
      setSaving(false);
    }
  };

  const mergeSpeaker = (from: string, into: string) => {
    if (!into || from === into) return;
    setDialog({
      kind: "confirm",
      title: m.detail.mergeTitle,
      text: fmt(m.detail.confirmMerge, { from: label(from), into: label(into) }),
      onConfirm: () => void doMergeSpeaker(from, into),
    });
  };

  const doMergeSpeaker = async (from: string, into: string) => {
    pushHistory(rec);
    setSaving(true);
    try {
      const r = await fetch(`/api/recordings/${rec.id}/speakers/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, into }),
      });
      if (r.ok) setRec((await r.json()) as RecordingDetail);
    } finally {
      setSaving(false);
    }
  };

  const assignTurn = async (turnSegments: number[], value: string) => {
    let speaker = value;
    if (value === "__new__") {
      const used = new Set(rec.speakers);
      let n = 0;
      while (used.has(`SPEAKER_${String(n).padStart(2, "0")}`)) n += 1;
      speaker = `SPEAKER_${String(n).padStart(2, "0")}`;
    }
    if (!speaker) return;
    await applyEdits(turnSegments.map((index) => ({ index, speaker })));
  };

  const undo = async () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSaving(true);
    try {
      const r = await fetch(`/api/recordings/${rec.id}/transcript`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prev),
      });
      if (r.ok) {
        const next = (await r.json()) as RecordingDetail;
        setRec(next);
        setNames(next.speakerNames);
      }
    } finally {
      setSaving(false);
    }
  };

  const copyTranscript = async (format: "txt" | "md") => {
    setCopyOpen(false);
    try {
      const text = await (await fetch(`/api/recordings/${rec.id}/export?format=${format}`)).text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      setActionError((err as Error).message);
    }
  };

  const startEdit = (index: number) => {
    setEditingIndex(index);
    setEditDraft(rec.segments[index]?.text ?? "");
  };
  const commitEdit = async () => {
    if (editingIndex === null) return;
    const index = editingIndex;
    const text = editDraft.trim();
    setEditingIndex(null);
    if (text && text !== rec.segments[index]?.text) await applyEdits([{ index, text }]);
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== rec.title) await patch({ title: titleDraft });
  };

  const saveNames = async () => {
    if (JSON.stringify(names) !== JSON.stringify(rec.speakerNames)) await patch({ speakerNames: names });
  };

  const [actionError, setActionError] = useState<string | null>(null);
  const rediarize = () => {
    setRediarizeCount(rec.speakerCount && rec.speakerCount > 1 ? String(rec.speakerCount) : "");
    setRediarizeMode("auto");
    setDialog({ kind: "rediarize" });
  };

  const submitRediarize = async () => {
    setDialog(null);
    const int = (v: string) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
    const body =
      rediarizeMode === "exact"
        ? { minSpeakers: int(rediarizeCount), maxSpeakers: int(rediarizeCount) }
        : rediarizeMode === "range"
          ? { minSpeakers: int(rediarizeMin), maxSpeakers: int(rediarizeMax) }
          : {};
    setActionError(null);
    const r = await fetch(`/api/recordings/${rec.id}/rediarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      setRec((await r.json()) as RecordingDetail);
      requestWorkerRefresh();
    } else {
      const code = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP:${r.status}`;
      setActionError(fmt(m.detail.rediarizeStartFailed, { detail: errorLabel(code, m) ?? code }));
    }
  };

  const remove = () =>
    setDialog({
      kind: "confirm",
      title: m.detail.deleteTitle,
      text: fmt(m.list.confirmDelete, { title: rec.title }),
      danger: true,
      onConfirm: () => void (async () => {
        const r = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
        if (r.ok) router.push("/");
      })(),
    });

  const retry = () => {
    if (rec.status === "COMPLETED") {
      setDialog({ kind: "confirm", title: m.detail.reprocessTitle, text: fmt(m.detail.confirmReprocess, { title: rec.title }), onConfirm: () => void doRetry() });
    } else void doRetry();
  };

  const doRetry = async () => {
    const r = await fetch(`/api/recordings/${rec.id}/retry`, { method: "POST" });
    if (r.ok) {
      setRec((await r.json()) as RecordingDetail);
      requestWorkerRefresh();
    }
  };

  const label = (id: string) => speakerLabel(id, rec.speakers, names, m);
  const langLabel = (m.languages as Record<string, string>)[rec.language] ?? rec.language;
  const phase = phaseLabel(rec.phase, m);
  const err = errorLabel(rec.error, m);

  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (dialog) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undoRef.current();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key;
      if (key === "j" || key === "k") {
        e.preventDefault();
        const dir = key === "j" ? 1 : -1;
        const cur = turns.findIndex((t) => t.segments.some((sg) => sg.index === activeIndex));
        const base = cur >= 0 ? cur : dir > 0 ? -1 : turns.findIndex((t) => t.start > time) - 0;
        const next = turns[Math.max(0, Math.min(turns.length - 1, base + dir))];
        if (next) seekTo(next.start, true);
      } else if ((key === "n" || key === "p") && matchCount > 0) {
        e.preventDefault();
        setMatchCursor((c) => (c + (key === "n" ? 1 : matchCount - 1)) % matchCount);
      } else if (key === "e" && activeIndex >= 0 && rec.status === "COMPLETED") {
        e.preventDefault();
        startEdit(activeIndex);
      } else if (key === "?") {
        e.preventDefault();
        setDialog({ kind: "shortcuts" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, activeIndex, time, matchCount, dialog, rec.status, seekTo]);

  // ------------------------------------------------------------------ render
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-[16rem] flex-1 basis-[28rem]">
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
              className="mt-1 cursor-text break-words text-2xl font-semibold hover:opacity-80"
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
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {rec.tags.map((t) => (
              <Link key={t} href={`/?tag=${encodeURIComponent(t)}`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700">
                {t}
              </Link>
            ))}
            <input
              className="input w-56 max-w-full py-0.5 text-xs"
              value={tagsDraft}
              placeholder={m.tags.placeholder}
              aria-label={m.tags.label}
              onChange={(e) => setTagsDraft(e.target.value)}
              onBlur={() => tagsDraft !== rec.tags.join(", ") && void patch({ tags: tagsDraft })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rec.status === "COMPLETED" && (
            <div className="relative">
              <button className="btn" onClick={() => setExportOpen((o) => !o)}>
                ⬇ {m.detail.export.replace(/:$/, "")} ▾
              </button>
              {exportOpen && (
                <div className="card absolute right-0 z-20 mt-1 flex min-w-[11rem] flex-col p-1 text-sm">
                  {EXPORTS.map((f) => (
                    <a key={f} className="rounded px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800" href={`/api/recordings/${rec.id}/export?format=${f}`} onClick={() => setExportOpen(false)}>
                      {m.detail.exportFormats[f]}
                    </a>
                  ))}
                  {rec.audioUrl && (
                    <a className="rounded border-t border-zinc-200 px-3 py-1.5 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800" href={`${rec.audioUrl}?download=1`} download onClick={() => setExportOpen(false)}>
                      {m.detail.downloadAudio}
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
          {rec.status === "COMPLETED" && rec.segments.length > 0 && (
            <div className="relative">
              <button className="btn" onClick={() => setCopyOpen((o) => !o)} title={m.detail.copy}>
                📋 {copied ? m.detail.copied : m.detail.copy} ▾
              </button>
              {copyOpen && (
                <div className="card absolute right-0 z-20 mt-1 flex min-w-[10rem] flex-col p-1 text-sm">
                  <button className="rounded px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => copyTranscript("txt")}>
                    {m.detail.copyText}
                  </button>
                  <button className="rounded px-3 py-1.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => copyTranscript("md")}>
                    {m.detail.copyMarkdown}
                  </button>
                </div>
              )}
            </div>
          )}
          {rec.status === "COMPLETED" && history.length > 0 && (
            <button className="btn" onClick={undo} title={m.detail.undoHint}>
              ↶ {m.detail.undo}
            </button>
          )}
          {rec.status === "COMPLETED" && rec.audioUrl && rec.segments.length > 0 && (
            <button className="btn" onClick={rediarize} title={m.detail.rediarizeHint}>
              👥 {m.detail.rediarize}
            </button>
          )}
          {rec.status === "COMPLETED" && (
            <button className="btn" onClick={retry} title={m.detail.confirmReprocess.split("?")[0]}>
              ↻ {m.detail.reprocess}
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

      {actionError && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
          {actionError}
        </div>
      )}

      {rec.status === "COMPLETED" && rec.warning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠ {warningLabel(rec.warning, m)}
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

      <section className="card p-4">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{m.notes.label}</h2>
          <span className="text-xs text-zinc-500">{notesSaved ? m.notes.saved : ""}</span>
        </div>
        <textarea
          className="input min-h-[72px] text-sm"
          value={notesDraft}
          placeholder={m.notes.placeholder}
          aria-label={m.notes.label}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={saveNotes}
        />
      </section>

      {rec.status === "COMPLETED" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <section className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{m.detail.transcript}</h2>
              <div className="flex items-center gap-3 text-xs text-zinc-500">
                {matcher && (
                  <span className="flex items-center gap-1">
                    {fmt(m.detail.searchMatches, { n: matchCount, q: query })}
                    {matchCount > 1 && (
                      <button className="btn px-1.5 py-0.5 text-xs" onClick={() => setMatchCursor((c) => (c + 1) % matchCount)}>
                        {m.detail.nextMatch} ›
                      </button>
                    )}
                  </span>
                )}
                <span className="hidden sm:inline" title={m.detail.editHint}>
                  ✎ {m.detail.editHint}
                </span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                  {m.detail.follow}
                </label>
              </div>
            </div>
            {turns.length === 0 ? (
              <p className="text-sm text-zinc-500">{m.detail.noSpeech}</p>
            ) : (
              <div className="space-y-4">
                {turns.map((turn, ti) => {
                  const c = speakerColor(turn.speaker, rec.speakers);
                  return (
                    <div key={ti} className="rounded-md border-l-4 pl-3" style={{ borderColor: c.border, background: c.bg }}>
                      <div className="group flex items-baseline gap-2 pt-1.5">
                        <span className="text-sm font-semibold" style={{ color: c.fg }}>
                          {label(turn.speaker)}
                        </span>
                        <button
                          className="font-mono text-xs text-zinc-500 hover:underline"
                          onClick={() => seekTo(turn.start, true)}
                        >
                          {formatTime(turn.start)}
                        </button>
                        <select
                          className="ml-auto mr-2 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-600 opacity-0 transition focus:opacity-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                          title={m.detail.assignSpeaker}
                          aria-label={m.detail.assignSpeaker}
                          value={turn.speaker}
                          onChange={(e) => assignTurn(turn.segments.map((sg) => sg.index), e.target.value)}
                        >
                          {rec.speakers.map((id) => (
                            <option key={id} value={id}>
                              {label(id)}
                            </option>
                          ))}
                          <option value="__new__">{m.detail.newSpeaker}</option>
                        </select>
                      </div>
                      <p className="pb-2 pt-0.5 text-[15px] leading-relaxed">
                        {turn.segments.map((seg) => {
                          const active = seg.index === activeIndex;
                          if (editingIndex === seg.index) {
                            return (
                              <textarea
                                key={seg.index}
                                autoFocus
                                className="input my-1 min-h-[60px] text-[15px]"
                                value={editDraft}
                                onChange={(e) => setEditDraft(e.target.value)}
                                onBlur={commitEdit}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    void commitEdit();
                                  } else if (e.key === "Escape") {
                                    setEditingIndex(null);
                                  }
                                }}
                              />
                            );
                          }
                          const words = active && seg.words?.length ? seg.words : null;
                          const counter = { n: matchOffsets.get(seg.index) ?? 0 };
                          return (
                            <span
                              key={seg.index}
                              ref={active ? activeRef : undefined}
                              onClick={() => seekTo(seg.start, true)}
                              onDoubleClick={(e) => {
                                e.preventDefault();
                                startEdit(seg.index);
                              }}
                              title={`${formatTime(seg.start)} – ${formatTime(seg.end)}`}
                              className={`cursor-pointer rounded px-0.5 transition ${
                                active ? "bg-yellow-100 dark:bg-yellow-900/40" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-700/50"
                              }`}
                            >
                              {words
                                ? words.map((w, wi) => (
                                    <span
                                      key={wi}
                                      onClick={(e) => {
                                        if (w.start == null) return;
                                        e.stopPropagation();
                                        seekTo(w.start, true);
                                      }}
                                      className={wi === activeWord ? "rounded bg-yellow-300 dark:bg-yellow-600/80" : undefined}
                                    >
                                      {matcher ? highlightMatches(w.word, matcher, counter, matchCursor, matchRef) : w.word}{" "}
                                    </span>
                                  ))
                                : matcher
                                  ? highlightMatches(seg.text, matcher, counter, matchCursor, matchRef)
                                  : seg.text}
                              {!words && " "}
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
            {Object.keys(rec.speakerSuggestions).some((id) => !names[id]) && (
              <button className="btn mb-3 w-full justify-center py-1 text-xs" onClick={() => applySuggestions()} data-testid="apply-all-suggestions">
                ✨ {m.voices.applyAll}
              </button>
            )}
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
                      {rec.speakerSuggestions[id] && !names[id] && (
                        <button
                          className="shrink-0 rounded border border-blue-300 bg-blue-50 px-1.5 py-1 text-xs text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300"
                          title={`${fmt(m.voices.looksLike, { name: rec.speakerSuggestions[id].name })} · ${Math.round(rec.speakerSuggestions[id].score * 100)} % · ${rec.speakerSuggestions[id].score >= 0.7 ? m.voices.strong : m.voices.weak}`}
                          onClick={() => applySuggestions([id])}
                          data-testid={`suggestion-${id}`}
                        >
                          ✨ {rec.speakerSuggestions[id].name} {Math.round(rec.speakerSuggestions[id].score * 100)} %
                        </button>
                      )}
                      {rec.speakers.length > 1 && (
                        <select
                          className="w-8 shrink-0 rounded border border-zinc-300 bg-white py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
                          title={m.detail.mergeInto}
                          aria-label={`${m.detail.mergeInto} ${label(id)}`}
                          value=""
                          onChange={(e) => mergeSpeaker(id, e.target.value)}
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
                <p className="pt-1 text-xs text-zinc-500">
                  {saving ? m.detail.saving : rec.speakersWithEmbedding.length > 0 ? `${m.detail.renameNote} ${m.voices.help}` : m.detail.renameNote}
                </p>
              </div>
            )}
            <div className="mt-5 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <h3 className="mb-1 text-sm font-semibold">{m.detail.hintsTitle}</h3>
              <textarea
                className="input min-h-[64px] text-sm"
                value={hintsDraft}
                onChange={(e) => setHintsDraft(e.target.value)}
                placeholder={m.upload.hintsPlaceholder}
              />
              <div className="mt-2 flex items-center gap-2">
                <button className="btn py-1 text-xs" disabled={hintsDraft === (rec.hints ?? "")} onClick={() => patch({ hints: hintsDraft })}>
                  {m.detail.hintsSave}
                </button>
                <span className="text-xs text-zinc-500">{m.detail.hintsNote}</span>
              </div>
            </div>
          </aside>
        </div>
      )}

      <Dialog
        open={dialog?.kind === "rediarize"}
        title={m.detail.rediarizeTitle}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-primary" onClick={submitRediarize}>
              {m.detail.start}
            </button>
          </>
        }
      >
        <p className="text-zinc-600 dark:text-zinc-300">{m.detail.rediarizeText}</p>
        <label className="flex items-center gap-2">
          <input type="radio" name="rmode" checked={rediarizeMode === "auto"} onChange={() => setRediarizeMode("auto")} /> {m.detail.rediarizeAuto}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="rmode" checked={rediarizeMode === "exact"} onChange={() => setRediarizeMode("exact")} /> {m.detail.rediarizeExact}
          <input className="input w-20 py-1" type="number" min={1} max={30} value={rediarizeCount} onFocus={() => setRediarizeMode("exact")} onChange={(e) => setRediarizeCount(e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="rmode" checked={rediarizeMode === "range"} onChange={() => setRediarizeMode("range")} /> {m.detail.rediarizeRange}
          <input className="input w-20 py-1" type="number" min={1} max={30} value={rediarizeMin} onFocus={() => setRediarizeMode("range")} onChange={(e) => setRediarizeMin(e.target.value)} />
          –
          <input className="input w-20 py-1" type="number" min={1} max={30} value={rediarizeMax} onFocus={() => setRediarizeMode("range")} onChange={(e) => setRediarizeMax(e.target.value)} />
        </label>
      </Dialog>

      <Dialog
        open={dialog?.kind === "confirm"}
        title={dialog?.kind === "confirm" ? dialog.title : ""}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button
              className={`btn ${dialog?.kind === "confirm" && dialog.danger ? "btn-danger" : "btn-primary"}`}
              onClick={() => {
                const d = dialog;
                setDialog(null);
                if (d?.kind === "confirm") d.onConfirm();
              }}
            >
              {m.detail.confirm}
            </button>
          </>
        }
      >
        <p>{dialog?.kind === "confirm" ? dialog.text : ""}</p>
      </Dialog>

      <Dialog open={dialog?.kind === "shortcuts"} title={m.detail.shortcuts} onClose={() => setDialog(null)}>
        <ul className="space-y-1">
          {Object.values(m.detail.shortcutList).map((line) => (
            <li key={line} className="text-zinc-700 dark:text-zinc-300">
              {line}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}
