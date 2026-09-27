"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ExportFormat, RecordingDetail } from "@note-taker/shared";
import { StatusBadge } from "../StatusBadge";
import { formatDate, formatDuration, phaseLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const EXPORTS: ExportFormat[] = ["md", "txt", "srt", "vtt"];

export interface RecordingPatch {
  title?: string;
  speakerNames?: Record<string, string>;
  hints?: string | null;
  tags?: string;
  notes?: string | null;
  favorite?: boolean;
  archived?: boolean;
}

/** Title (click to rename), metadata, tags and the action toolbar. */
export function RecordingHeader({
  rec,
  canUndo,
  onPatch,
  onUndo,
  onRediarize,
  onRetry,
  onDelete,
  onError,
}: {
  rec: RecordingDetail;
  canUndo: boolean;
  onPatch: (body: RecordingPatch) => Promise<boolean>;
  onUndo: () => void;
  onRediarize: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onError: (err: unknown) => void;
}) {
  const { locale, m, tz } = useI18n();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(rec.title);
  const [tagsDraft, setTagsDraft] = useState(rec.tags.join(", "));
  useEffect(() => setTagsDraft(rec.tags.join(", ")), [rec.tags]);
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const completed = rec.status === "COMPLETED";
  const langLabel = (m.languages as Record<string, string>)[rec.language] ?? rec.language;

  const saveTitle = async () => {
    setEditingTitle(false);
    if (titleDraft.trim() && titleDraft.trim() !== rec.title) await onPatch({ title: titleDraft });
  };

  const copyTranscript = async (format: "txt" | "md") => {
    setCopyOpen(false);
    try {
      const text = await (await fetch(`/api/recordings/${rec.id}/export?format=${format}`)).text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-[16rem] flex-1 basis-[28rem]">
        <Link href="/" className="text-sm text-zinc-500 hover:underline print:hidden">
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
          <StatusBadge status={rec.status} title={phaseLabel(rec.phase, m)} progress={rec.progress} />
          <span>{formatDate(rec.createdAt, locale, tz)}</span>
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
            className="input w-56 max-w-full py-0.5 text-xs print:hidden"
            value={tagsDraft}
            placeholder={m.tags.placeholder}
            aria-label={m.tags.label}
            onChange={(e) => setTagsDraft(e.target.value)}
            onBlur={() => tagsDraft !== rec.tags.join(", ") && void onPatch({ tags: tagsDraft })}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <button
          className={`btn ${rec.favorite ? "text-amber-500" : ""}`}
          title={rec.favorite ? m.library.unstar : m.library.star}
          aria-label={rec.favorite ? m.library.unstar : m.library.star}
          aria-pressed={rec.favorite}
          onClick={() => onPatch({ favorite: !rec.favorite })}
        >
          {rec.favorite ? "★" : "☆"}
        </button>
        <button className="btn" title={rec.archived ? m.library.unarchive : m.library.archive} onClick={() => onPatch({ archived: !rec.archived })}>
          {rec.archived ? `⤴ ${m.library.unarchive}` : `🗄 ${m.library.archive}`}
        </button>
        {completed && (
          <div className="relative">
            <button className="btn" onClick={() => setExportOpen((o) => !o)} aria-haspopup="menu" aria-expanded={exportOpen}>
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
                <button
                  className="rounded border-t border-zinc-200 px-3 py-1.5 text-left hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                  onClick={() => {
                    setExportOpen(false);
                    window.print();
                  }}
                  data-testid="print"
                >
                  🖨 {m.detail.print}
                </button>
              </div>
            )}
          </div>
        )}
        {completed && rec.segments.length > 0 && (
          <div className="relative">
            <button className="btn" onClick={() => setCopyOpen((o) => !o)} title={m.detail.copy} aria-haspopup="menu" aria-expanded={copyOpen}>
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
        {completed && canUndo && (
          <button className="btn" onClick={onUndo} title={m.detail.undoHint}>
            ↶ {m.detail.undo}
          </button>
        )}
        {completed && rec.audioUrl && rec.segments.length > 0 && (
          <button className="btn" onClick={onRediarize} title={m.detail.rediarizeHint}>
            👥 {m.detail.rediarize}
          </button>
        )}
        {completed && (
          <button className="btn" onClick={onRetry} title={m.detail.confirmReprocess.split("?")[0]}>
            ↻ {m.detail.reprocess}
          </button>
        )}
        <button className="btn btn-danger" onClick={onDelete}>
          {m.detail.delete}
        </button>
      </div>
    </div>
  );
}
