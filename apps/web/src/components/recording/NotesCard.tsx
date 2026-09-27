"use client";

import { useEffect, useState } from "react";
import { Markdown } from "../Markdown";
import { useI18n } from "@/lib/i18n/client";

/** Markdown notes of a recording: rendered preview, click to edit, saved on blur. */
export function NotesCard({ notes, onSave }: { notes: string | null; onSave: (notes: string) => Promise<boolean> }) {
  const { m } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notes ?? "");
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(notes ?? ""), [notes]);

  const save = async () => {
    setEditing(false);
    if (draft === (notes ?? "")) return;
    if (await onSave(draft)) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };

  return (
    <section className="card p-4" data-print={notes ? "notes" : "hide"}>
      {notes && (
        <div className="hidden print:block">
          <h2 className="text-sm font-semibold">{m.notes.label}</h2>
          <Markdown text={notes} />
        </div>
      )}
      <div className="mb-1 flex items-center justify-between print:hidden">
        <h2 className="text-sm font-semibold">{m.notes.label}</h2>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {saved ? m.notes.saved : ""}
          {!editing && (
            <button className="btn py-0.5 text-xs" onClick={() => setEditing(true)} data-testid="notes-edit">
              ✎ {m.notes.edit}
            </button>
          )}
        </span>
      </div>
      {editing ? (
        <textarea
          className="input min-h-[96px] text-sm"
          autoFocus
          value={draft}
          placeholder={m.notes.placeholder}
          aria-label={m.notes.label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Escape" && save()}
          data-print="hide"
        />
      ) : notes ? (
        <div className="cursor-text print:hidden" onClick={() => setEditing(true)} data-testid="notes-preview">
          <Markdown text={notes} />
        </div>
      ) : (
        <p className="cursor-text text-sm text-zinc-400 print:hidden" onClick={() => setEditing(true)}>
          {m.notes.empty}
        </p>
      )}
    </section>
  );
}
