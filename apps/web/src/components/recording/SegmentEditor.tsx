"use client";

import { useRef, useState } from "react";
import type { TranscriptSegment } from "@note-taker/shared";
import { useI18n } from "@/lib/i18n/client";

export interface SegmentDraft {
  text: string;
  /** Parsed start/end in seconds, null when the field is empty or invalid. */
  start: number | null;
  end: number | null;
}

function fmtSec(v: number) {
  const s = Math.max(0, v);
  const mm = Math.floor(s / 60);
  const ss = (s - mm * 60).toFixed(1).padStart(4, "0");
  return `${mm}:${ss}`;
}

function parseSec(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  const parts = t.split(":").map((x) => Number(x.replace(",", ".")));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  return parts.reduce((a, x) => a * 60 + x, 0);
}

/** Inline editor of one segment's text and times; Ctrl+Enter splits at the cursor. */
export function SegmentEditor({
  segment,
  onCommit,
  onSplit,
  onCancel,
}: {
  segment: TranscriptSegment;
  onCommit: (draft: SegmentDraft) => void;
  onSplit: (text: string, position: number) => void;
  onCancel: () => void;
}) {
  const { m } = useI18n();
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(fmtSec(segment.start));
  const [end, setEnd] = useState(fmtSec(segment.end));
  const ref = useRef<HTMLTextAreaElement>(null);

  const commit = () => onCommit({ text: text.trim(), start: parseSec(start), end: parseSec(end) });
  const split = () => onSplit(text.trim(), ref.current ? ref.current.selectionStart : Math.floor(text.length / 2));

  return (
    <span
      className="my-1 block rounded-md border border-blue-300 bg-white p-2 dark:border-blue-800 dark:bg-zinc-900"
      data-testid="segment-editor"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        autoFocus
        className="input min-h-[60px] text-[15px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            split();
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            onCancel();
          }
        }}
      />
      <span className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-zinc-500">
          {m.detail.timeStart}
          <input className="input w-20 py-0.5 font-mono text-xs" value={start} onChange={(e) => setStart(e.target.value)} aria-label={m.detail.timeStart} />
        </label>
        <label className="flex items-center gap-1 text-zinc-500">
          {m.detail.timeEnd}
          <input className="input w-20 py-0.5 font-mono text-xs" value={end} onChange={(e) => setEnd(e.target.value)} aria-label={m.detail.timeEnd} />
        </label>
        <span className="ml-auto flex gap-1">
          <button className="btn py-0.5 text-xs" onClick={split} title={m.detail.splitHint}>
            ✂ {m.detail.split}
          </button>
          <button className="btn py-0.5 text-xs" onClick={onCancel}>
            {m.detail.cancel}
          </button>
          <button className="btn btn-primary py-0.5 text-xs" onClick={commit}>
            {m.detail.save}
          </button>
        </span>
      </span>
    </span>
  );
}
