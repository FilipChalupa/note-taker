"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RecordingDetail, SegmentEdit, TranscriptMutationResult, TranscriptSegment } from "@note-taker/shared";
import { computeSpeakerStats } from "@note-taker/shared";
import { api } from "@/lib/api-client";
import { useToast } from "./Toast";
import { requestWorkerRefresh } from "./WorkerStatus";
import { PlayerControls } from "./player/PlayerControls";
import { usePlayer } from "./player/PlayerProvider";
import { NotesCard } from "./recording/NotesCard";
import { RecordingHeader, type RecordingPatch } from "./recording/RecordingHeader";
import { SegmentEditor, type SegmentDraft } from "./recording/SegmentEditor";
import { SpeakersPanel } from "./recording/SpeakersPanel";
import { TranscriptTurn } from "./recording/TranscriptTurn";
import { ConfirmDialog, RediarizeDialog, ShortcutsDialog, type ConfirmRequest, type RediarizeOptions } from "./recording/dialogs";
import { useTranscriptSearch } from "./recording/useTranscriptSearch";
import { useElementHeight, useTranscriptWindow } from "./recording/useTranscriptWindow";
import { errorLabel, groupTurns, phaseLabel, speakerLabel, warningLabel } from "@/lib/format";
import { AudioQualityWarning } from "./recording/AudioQualityNote";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 2500;

type Snapshot = Pick<RecordingDetail, "segments" | "speakers" | "speakerNames">;
type DialogState = null | { kind: "rediarize" } | ({ kind: "confirm" } & ConfirmRequest) | { kind: "shortcuts" };

export function RecordingView({ initial }: { initial: RecordingDetail }) {
  const { m } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const [rec, setRec] = useState(initial);
  const [names, setNames] = useState<Record<string, string>>(rec.speakerNames);
  useEffect(() => setNames(rec.speakerNames), [rec.speakerNames]);

  /** Apply a light mutation result (head + patch) to local state without re-downloading segments. */
  const applyMutation = (res: TranscriptMutationResult) => {
    setRec((prev) => {
      let segments: TranscriptSegment[] = prev.segments;
      const p = res.patch;
      if (p.kind === "edits") segments = prev.segments.map((sg, i) => p.segments[i] ?? sg);
      else if (p.kind === "splice") segments = [...prev.segments.slice(0, p.index), ...p.insert, ...prev.segments.slice(p.index + p.remove)];
      else if (p.kind === "speakerMerge")
        segments = prev.segments.map((sg) =>
          sg.speaker === p.from ? { ...sg, speaker: p.into, words: sg.words?.map((w) => (w.speaker === p.from ? { ...w, speaker: p.into } : w)) } : sg,
        );
      return { ...res.recording, segments };
    });
    setNames(res.recording.speakerNames);
  };
  const fail = (err: unknown) => toast.error(fmt(m.toast.failed, { detail: (err as Error).message }));
  const inflight = rec.status === "QUEUED" || rec.status === "PROCESSING";

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
  const stats = useMemo(() => computeSpeakerStats(rec.segments, rec.speakers), [rec.segments, rec.speakers]);
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

  const searchParams = useSearchParams();
  const search = useTranscriptSearch(rec.segments, (searchParams.get("q") ?? "").trim());
  const { matcher, matchCount, matchCursor, stepMatch } = search;
  const searchRef = useRef<HTMLInputElement>(null);
  const activeRef = useRef<HTMLSpanElement>(null);
  const win = useTranscriptWindow(turns, { active: activeRef, match: search.matchRef });
  const playerCardRef = useRef<HTMLDivElement>(null);
  const playerH = useElementHeight(playerCardRef, rec.audioUrl);

  useEffect(() => {
    if (!matcher || matchCount === 0) return;
    // Small delay so the page does not jump on every keystroke while the query is being typed
    const t = setTimeout(() => win.reveal(search.segmentOfMatch(matchCursor), "match"), 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchCursor, matchCount, matcher]);

  useEffect(() => {
    if (follow && playing && activeIndex >= 0) win.reveal(activeIndex, "active");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, follow, playing]);

  // ---------------------------------------------------------------- editing
  const [history, setHistory] = useState<Snapshot[]>([]);
  const pushHistory = (r: RecordingDetail) =>
    setHistory((h) => [...h.slice(-49), { segments: r.segments, speakers: r.speakers, speakerNames: r.speakerNames }]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [glossarySuggest, setGlossarySuggest] = useState<string[] | null>(null);
  const [glossaryAdded, setGlossaryAdded] = useState(false);
  const glossaryRef = useRef<Set<string> | null>(null);
  const knownGlossary = async () => {
    if (!glossaryRef.current) {
      try {
        const g = ((await (await fetch("/api/settings")).json()) as { glossary: string }).glossary;
        glossaryRef.current = new Set(g.split(/[\n,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean));
      } catch {
        glossaryRef.current = new Set();
      }
    }
    return glossaryRef.current;
  };

  /** Run a light transcript mutation; `undoable` records a snapshot first and drops it on failure. */
  const mutate = async (path: string, init: RequestInit, undoable = false) => {
    if (undoable) pushHistory(rec);
    setSaving(true);
    try {
      applyMutation(await api<TranscriptMutationResult>(m, path, init));
      return true;
    } catch (err) {
      if (undoable) setHistory((h) => h.slice(0, -1));
      fail(err);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const patch = (body: RecordingPatch) => mutate(`/api/recordings/${rec.id}?light=1`, { method: "PATCH", body: JSON.stringify(body) });

  const applySuggestions = (speakers?: string[]) =>
    void mutate(`/api/recordings/${rec.id}/speakers/apply-suggestions?light=1`, { method: "POST", body: JSON.stringify({ speakers }) });

  const applyEdits = (edits: SegmentEdit[]) =>
    mutate(`/api/recordings/${rec.id}/segments?light=1`, { method: "PATCH", body: JSON.stringify({ edits }) }, true);

  const mergeSpeaker = (from: string, into: string) => {
    if (!into || from === into) return;
    setDialog({
      kind: "confirm",
      title: m.detail.mergeTitle,
      text: fmt(m.detail.confirmMerge, { from: label(from), into: label(into) }),
      onConfirm: () =>
        void mutate(`/api/recordings/${rec.id}/speakers/merge?light=1`, { method: "POST", body: JSON.stringify({ from, into }) }, true),
    });
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
      const res = await api<TranscriptMutationResult>(m, `/api/recordings/${rec.id}/transcript?light=1`, { method: "PUT", body: JSON.stringify(prev) });
      setRec({ ...res.recording, segments: prev.segments });
      setNames(res.recording.speakerNames);
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const splitSegment = async (index: number, text: string, position: number) => {
    setEditingIndex(null);
    pushHistory(rec);
    setSaving(true);
    try {
      // persist a text change first so the split works on what the user sees
      if (text && text !== rec.segments[index]?.text) {
        applyMutation(await api<TranscriptMutationResult>(m, `/api/recordings/${rec.id}/segments?light=1`, { method: "PATCH", body: JSON.stringify({ edits: [{ index, text }] }) }));
      }
      applyMutation(await api<TranscriptMutationResult>(m, `/api/recordings/${rec.id}/segments/split?light=1`, { method: "POST", body: JSON.stringify({ index, position }) }));
    } catch (err) {
      fail(err);
    } finally {
      setSaving(false);
    }
  };

  const commitEdit = async (index: number, { text, start, end }: SegmentDraft) => {
    const seg = rec.segments[index];
    const before = seg?.text ?? "";
    setEditingIndex(null);
    const timeChanged = seg && ((start != null && Math.abs(start - seg.start) > 0.01) || (end != null && Math.abs(end - seg.end) > 0.01));
    if ((!text || text === before) && !timeChanged) return;
    const edit: SegmentEdit = { index };
    if (text && text !== before) edit.text = text;
    if (timeChanged) {
      if (start != null) edit.start = start;
      if (end != null) edit.end = end;
    }
    await applyEdits([edit]);
    if (!edit.text) return;
    // Words that appear only after the correction are glossary candidates ("Kadlova" -> "Karlova")
    const tokens = (t: string) => t.split(/\s+/).map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")).filter((w) => w.length >= 3 && /\p{L}/u.test(w));
    const old = new Set(tokens(before).map((w) => w.toLowerCase()));
    const known = await knownGlossary();
    const candidates = [...new Set(tokens(text))].filter((w) => !old.has(w.toLowerCase()) && !known.has(w.toLowerCase())).slice(0, 3);
    setGlossaryAdded(false);
    setGlossarySuggest(candidates.length ? candidates : null);
  };

  const addToGlossary = async (terms: string[]) => {
    try {
      await api(m, "/api/settings/glossary", { method: "POST", body: JSON.stringify({ terms }) });
      for (const t of terms) glossaryRef.current?.add(t.toLowerCase());
      setGlossarySuggest(null);
      setGlossaryAdded(true);
      setTimeout(() => setGlossaryAdded(false), 2500);
    } catch (err) {
      fail(err);
    }
  };

  const saveNames = async () => {
    if (JSON.stringify(names) !== JSON.stringify(rec.speakerNames)) await patch({ speakerNames: names });
  };

  const submitRediarize = async (options: RediarizeOptions) => {
    setDialog(null);
    setActionError(null);
    try {
      setRec(await api<RecordingDetail>(m, `/api/recordings/${rec.id}/rediarize`, { method: "POST", body: JSON.stringify(options) }));
      requestWorkerRefresh();
    } catch (err) {
      setActionError(fmt(m.detail.rediarizeStartFailed, { detail: (err as Error).message }));
    }
  };

  const remove = () =>
    setDialog({
      kind: "confirm",
      title: m.detail.deleteTitle,
      text: fmt(m.list.confirmDelete, { title: rec.title }),
      danger: true,
      onConfirm: () => void (async () => {
        try {
          await api<void>(m, `/api/recordings/${rec.id}`, { method: "DELETE" });
          toast.success(m.toast.deleted);
          router.push("/");
        } catch (err) {
          fail(err);
        }
      })(),
    });

  const doRetry = async () => {
    try {
      setRec(await api<RecordingDetail>(m, `/api/recordings/${rec.id}/retry`, { method: "POST" }));
      requestWorkerRefresh();
    } catch (err) {
      fail(err);
    }
  };

  const retry = () => {
    if (rec.status === "COMPLETED") {
      setDialog({ kind: "confirm", title: m.detail.reprocessTitle, text: fmt(m.detail.confirmReprocess, { title: rec.title }), onConfirm: () => void doRetry() });
    } else void doRetry();
  };

  const label = (id: string) => speakerLabel(id, rec.speakers, names, m);
  const phase = phaseLabel(rec.phase, m);
  const err = errorLabel(rec.error, m);

  const undoRef = useRef(undo);
  undoRef.current = undo;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f" && rec.status === "COMPLETED" && rec.segments.length > 0 && !dialog) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
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
        const base = cur >= 0 ? cur : dir > 0 ? -1 : turns.findIndex((t) => t.start > time);
        const next = turns[Math.max(0, Math.min(turns.length - 1, base + dir))];
        if (next) seekTo(next.start, true);
      } else if ((key === "n" || key === "p") && matchCount > 0) {
        e.preventDefault();
        stepMatch(key === "n" ? 1 : -1);
      } else if (key === "e" && activeIndex >= 0 && rec.status === "COMPLETED") {
        e.preventDefault();
        setEditingIndex(activeIndex);
      } else if (key === "?") {
        e.preventDefault();
        setDialog({ kind: "shortcuts" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, activeIndex, time, matchCount, dialog, rec.status, rec.segments.length, seekTo]);

  // ------------------------------------------------------------------ render
  return (
    <div className="space-y-5">
      <RecordingHeader
        rec={rec}
        canUndo={history.length > 0}
        onPatch={patch}
        onUndo={undo}
        onRediarize={() => setDialog({ kind: "rediarize" })}
        onRetry={retry}
        onDelete={remove}
        onError={fail}
      />

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
          <p className="mt-3 text-xs text-zinc-500">{m.detail.autoRefresh}</p>
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

      {rec.status === "COMPLETED" && rec.audioQuality && <AudioQualityWarning quality={rec.audioQuality} />}

      {rec.status === "FAILED" && (
        <div className="card border-red-300 p-5 dark:border-red-800">
          <div className="font-medium text-red-700 dark:text-red-300">{m.detail.failed}</div>
          <pre className="mt-2 whitespace-pre-wrap text-xs text-red-600 dark:text-red-400">{err}</pre>
        </div>
      )}

      {rec.audioUrl && (
        <div ref={playerCardRef} className="card sticky top-2 z-10 p-4 print:hidden">
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

      <NotesCard notes={rec.notes} onSave={(notes) => patch({ notes })} />

      {rec.status === "COMPLETED" && (
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <section className="card p-5">
            <div
              className="sticky z-[9] -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-white/95 px-5 pb-2 pt-5 backdrop-blur dark:bg-zinc-900/95 print:static print:m-0 print:p-0"
              style={{ top: rec.audioUrl ? playerH + 12 : 8 }}
            >
              <h2 className="font-semibold">{m.detail.transcript}</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 print:hidden">
                <span className="flex items-center gap-1">
                  <input
                    ref={searchRef}
                    type="search"
                    className="input w-44 py-0.5 text-xs"
                    value={search.query}
                    placeholder={m.detail.searchInTranscript}
                    aria-label={m.detail.searchInTranscript}
                    data-testid="transcript-search"
                    onChange={(e) => search.setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && matchCount > 0) {
                        e.preventDefault();
                        stepMatch(e.shiftKey ? -1 : 1);
                      } else if (e.key === "Escape") {
                        search.setQuery("");
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                  {matcher && (
                    <>
                      <span data-testid="match-count">{fmt(m.detail.searchMatches, { n: matchCount, q: search.query.trim() })}</span>
                      {matchCount > 1 && (
                        <>
                          <button className="btn px-1.5 py-0.5 text-xs" onClick={() => stepMatch(-1)} aria-label={m.detail.prevMatch}>
                            ‹
                          </button>
                          <button className="btn px-1.5 py-0.5 text-xs" onClick={() => stepMatch(1)} aria-label={m.detail.nextMatch}>
                            ›
                          </button>
                        </>
                      )}
                    </>
                  )}
                </span>
                <span className="hidden sm:inline" title={m.detail.editHint}>
                  ✎ {m.detail.editHint}
                </span>
                <label className="flex items-center gap-1.5">
                  <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
                  {m.detail.follow}
                </label>
              </div>
            </div>
            {(glossarySuggest || glossaryAdded) && (
              <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950" data-testid="glossary-suggest">
                {glossaryAdded ? (
                  <span className="text-emerald-700 dark:text-emerald-300">✓ {m.glossarySuggest.added}</span>
                ) : (
                  <>
                    <span>{fmt(m.glossarySuggest.text, { terms: glossarySuggest!.map((t) => `„${t}“`).join(", ") })}</span>
                    <button className="btn py-0.5 text-xs" onClick={() => addToGlossary(glossarySuggest!)}>
                      {m.glossarySuggest.add}
                    </button>
                    <button className="text-xs text-zinc-500 hover:underline" onClick={() => setGlossarySuggest(null)}>
                      {m.glossarySuggest.dismiss}
                    </button>
                  </>
                )}
              </div>
            )}
            {turns.length === 0 ? (
              <p className="text-sm text-zinc-500">{m.detail.noSpeech}</p>
            ) : (
              <div
                ref={win.listRef}
                data-testid="turns"
                data-virtual={win.virtual ? "1" : "0"}
                // overflow-anchor: none, otherwise Chrome's scroll anchoring undoes programmatic jumps when the window re-renders
                style={{ overflowAnchor: "none" }}
              >
                {win.virtual && <div style={{ height: win.topSpacer }} aria-hidden />}
                {win.visible.map((turn, k) => {
                  const ti = win.start + k;
                  return (
                    <TranscriptTurn
                      key={ti}
                      turn={turn}
                      speakers={rec.speakers}
                      label={label}
                      activeIndex={activeIndex}
                      activeWord={activeWord}
                      activeRef={activeRef}
                      editingIndex={editingIndex}
                      renderEditor={(seg) => (
                        <SegmentEditor
                          key={seg.index}
                          segment={seg}
                          onCommit={(draft) => void commitEdit(seg.index, draft)}
                          onSplit={(text, position) => void splitSegment(seg.index, text, position)}
                          onCancel={() => setEditingIndex(null)}
                        />
                      )}
                      search={search}
                      measureRef={win.measure(ti)}
                      onSeek={(t) => seekTo(t, true)}
                      onStartEdit={setEditingIndex}
                      onAssign={assignTurn}
                    />
                  );
                })}
                {win.virtual && <div style={{ height: win.bottomSpacer }} aria-hidden />}
              </div>
            )}
          </section>

          <SpeakersPanel
            rec={rec}
            names={names}
            label={label}
            stats={stats}
            saving={saving}
            onNameChange={(id, name) => setNames((n) => ({ ...n, [id]: name }))}
            onNamesCommit={saveNames}
            onApplySuggestions={applySuggestions}
            onMerge={mergeSpeaker}
            onSaveHints={(hints) => void patch({ hints })}
          />
        </div>
      )}

      <RediarizeDialog open={dialog?.kind === "rediarize"} speakerCount={rec.speakerCount} onClose={() => setDialog(null)} onSubmit={submitRediarize} />
      <ConfirmDialog request={dialog?.kind === "confirm" ? dialog : null} onClose={() => setDialog(null)} />
      <ShortcutsDialog open={dialog?.kind === "shortcuts"} onClose={() => setDialog(null)} />
    </div>
  );
}
