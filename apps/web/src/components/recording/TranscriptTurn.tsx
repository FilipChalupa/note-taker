"use client";

import { Fragment } from "react";
import type { TranscriptSegment } from "@note-taker/shared";
import type { SpeakerTurn } from "@/lib/format";
import { formatTime, speakerColor } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { highlightMatches } from "./highlight";

export interface TurnSearch {
  matcher: RegExp | null;
  matchOffsets: Map<number, number>;
  matchCursor: number;
  matchRef: React.RefObject<HTMLSpanElement | null>;
}

/** One speaker turn: header with speaker/time/reassign, then its clickable segments. */
export function TranscriptTurn({
  turn,
  speakers,
  label,
  activeIndex,
  activeWord,
  activeRef,
  editingIndex,
  renderEditor,
  search,
  measureRef,
  onSeek,
  onStartEdit,
  onAssign,
}: {
  turn: SpeakerTurn;
  speakers: string[];
  label: (id: string) => string;
  activeIndex: number;
  activeWord: number;
  activeRef: React.RefObject<HTMLSpanElement | null>;
  editingIndex: number | null;
  renderEditor: (segment: TranscriptSegment & { index: number }) => React.ReactNode;
  search: TurnSearch;
  measureRef: (el: HTMLDivElement | null) => void;
  onSeek: (t: number) => void;
  onStartEdit: (index: number) => void;
  onAssign: (segmentIndexes: number[], speaker: string) => void;
}) {
  const { m } = useI18n();
  const c = speakerColor(turn.speaker, speakers);
  const { matcher, matchOffsets, matchCursor, matchRef } = search;
  return (
    <div ref={measureRef} className="turn mb-4 rounded-md border-l-4 pl-3" style={{ borderColor: c.border, background: c.bg }}>
      <div className="group flex items-baseline gap-2 pt-1.5">
        <span className="text-sm font-semibold" style={{ color: c.fg }}>
          {label(turn.speaker)}
        </span>
        <button className="font-mono text-xs text-zinc-500 hover:underline" onClick={() => onSeek(turn.start)}>
          {formatTime(turn.start)}
        </button>
        <select
          className="ml-auto mr-2 rounded border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-600 opacity-0 transition focus:opacity-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          title={m.detail.assignSpeaker}
          aria-label={m.detail.assignSpeaker}
          value={turn.speaker}
          onChange={(e) => onAssign(turn.segments.map((sg) => sg.index), e.target.value)}
        >
          {speakers.map((id) => (
            <option key={id} value={id}>
              {label(id)}
            </option>
          ))}
          <option value="__new__">{m.detail.newSpeaker}</option>
        </select>
      </div>
      <p className="pb-2 pt-0.5 text-[15px] leading-relaxed">
        {turn.segments.map((seg) => {
          if (editingIndex === seg.index) return <Fragment key={seg.index}>{renderEditor(seg)}</Fragment>;
          const active = seg.index === activeIndex;
          const words = active && seg.words?.length ? seg.words : null;
          const counter = { n: matchOffsets.get(seg.index) ?? 0 };
          return (
            <span
              key={seg.index}
              ref={active ? activeRef : undefined}
              onClick={() => onSeek(seg.start)}
              onDoubleClick={(e) => {
                e.preventDefault();
                onStartEdit(seg.index);
              }}
              title={`${formatTime(seg.start)} – ${formatTime(seg.end)}`}
              className={`cursor-pointer rounded px-0.5 transition ${active ? "bg-yellow-100 dark:bg-yellow-900/40" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-700/50"}`}
            >
              {words
                ? words.map((w, wi) => (
                    <span
                      key={wi}
                      onClick={(e) => {
                        if (w.start == null) return;
                        e.stopPropagation();
                        onSeek(w.start);
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
}
