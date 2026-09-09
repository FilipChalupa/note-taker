"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BulkAction, RecordingListQuery, RecordingPage, RecordingSort, RecordingSummary, RecordingView, TagCount } from "@note-taker/shared";
import { StatusBadge } from "./StatusBadge";
import { Dialog } from "./Dialog";
import { requestWorkerRefresh } from "./WorkerStatus";
import { errorLabel, formatDate, formatDuration, phaseLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 3000;
const SORTS: RecordingSort[] = ["newest", "oldest", "title", "longest", "shortest"];
const VIEWS: RecordingView[] = ["active", "favorites", "archived"];

export function TagChips({ tags }: { tags: string[] }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.map((t) => (
        <Link key={t} href={`/?tag=${encodeURIComponent(t)}`} className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          {t}
        </Link>
      ))}
    </div>
  );
}

function buildHref(q: RecordingListQuery, patch: Partial<RecordingListQuery>): string {
  const next = { ...q, ...patch };
  const p = new URLSearchParams();
  if (next.tag) p.set("tag", next.tag);
  if (next.view && next.view !== "active") p.set("view", next.view);
  if (next.sort && next.sort !== "newest") p.set("sort", next.sort);
  if (next.page && next.page > 1) p.set("page", String(next.page));
  const qs = p.toString();
  return qs ? `/?${qs}` : "/";
}

export function RecordingList({ initial, tags, query }: { initial: RecordingPage; tags: TagCount[]; query: RecordingListQuery }) {
  const { locale, m } = useI18n();
  const router = useRouter();
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<null | { kind: "tag"; action: "addTag" | "removeTag" } | { kind: "delete" }>(null);
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<number>(-1);
  useEffect(() => {
    setData(initial);
    // keep selection and keyboard cursor across refreshes (drop ids that disappeared, clamp the cursor)
    const ids = new Set(initial.items.map((r) => r.id));
    setSelected((s) => new Set([...s].filter((id) => ids.has(id))));
    setCursor((c) => (c < 0 ? c : Math.min(c, initial.items.length - 1)));
  }, [initial]);

  const apiUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (query.tag) p.set("tag", query.tag);
    if (query.view) p.set("view", query.view);
    if (query.sort) p.set("sort", query.sort);
    p.set("page", String(query.page ?? 1));
    return `/api/recordings?${p.toString()}`;
  }, [query]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(apiUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData((await r.json()) as RecordingPage);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [apiUrl]);

  const items = data.items;
  const inflight = items.some((r) => r.status === "QUEUED" || r.status === "PROCESSING");
  useEffect(() => {
    if (!inflight) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [inflight, refresh]);

  const patchOne = async (rec: RecordingSummary, body: Record<string, unknown>) => {
    const r = await fetch(`/api/recordings/${rec.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) router.refresh();
  };

  const remove = async (rec: RecordingSummary) => {
    if (!confirm(fmt(m.list.confirmDelete, { title: rec.title }))) return;
    const r = await fetch(`/api/recordings/${rec.id}`, { method: "DELETE" });
    if (r.ok) router.refresh();
  };

  const retry = async (rec: RecordingSummary) => {
    await fetch(`/api/recordings/${rec.id}/retry`, { method: "POST" });
    requestWorkerRefresh();
    void refresh();
  };

  const bulk = async (action: BulkAction, tag?: string) => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await fetch("/api/recordings/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, tag }),
      });
      setSelected(new Set());
      setDialog(null);
      router.refresh();
      requestWorkerRefresh();
    } finally {
      setBusy(false);
    }
  };

  // Keyboard navigation: arrows / j k move, Enter opens, Space selects, A all, F favorite, E archive, T tag, Delete, Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (dialog || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = items.length;
      if (n === 0) return;
      const key = e.key;
      const move = (d: number) => {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(n - 1, (c < 0 ? (d > 0 ? -1 : n) : c) + d)));
      };
      if (key === "ArrowDown" || key === "j") move(1);
      else if (key === "ArrowUp" || key === "k") move(-1);
      else if (key === "Home") {
        e.preventDefault();
        setCursor(0);
      } else if (key === "End") {
        e.preventDefault();
        setCursor(n - 1);
      } else if (key === "Enter" && cursor >= 0) {
        e.preventDefault();
        router.push(`/recordings/${items[cursor].id}`);
      } else if ((key === " " || key === "x") && cursor >= 0) {
        e.preventDefault();
        toggle(items[cursor].id);
      } else if (key === "a") {
        e.preventDefault();
        setSelected(allOnPage ? new Set() : new Set(items.map((r) => r.id)));
      } else if (key === "Escape") {
        setSelected(new Set());
        setCursor(-1);
      } else if (key === "f" && cursor >= 0) {
        e.preventDefault();
        void patchOne(items[cursor], { favorite: !items[cursor].favorite });
      } else if (key === "e" && cursor >= 0) {
        e.preventDefault();
        void patchOne(items[cursor], { archived: !items[cursor].archived });
      } else if (key === "t" && selected.size > 0) {
        e.preventDefault();
        setDialog({ kind: "tag", action: "addTag" });
      } else if ((key === "Delete" || key === "Backspace") && selected.size > 0) {
        e.preventDefault();
        setDialog({ kind: "delete" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, cursor, selected, dialog]);

  useEffect(() => {
    if (cursor < 0) return;
    document.querySelector<HTMLElement>(`[data-row-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOnPage = items.length > 0 && items.every((r) => selected.has(r.id));
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const view = query.view ?? "active";
  const sort = query.sort ?? "newest";
  const sortLabel: Record<RecordingSort, string> = {
    newest: m.listx.sortNewest,
    oldest: m.listx.sortOldest,
    title: m.listx.sortTitle,
    longest: m.listx.sortLongest,
    shortest: m.listx.sortShortest,
  };
  const viewLabel: Record<RecordingView, string> = { active: m.listx.viewActive, favorites: m.listx.viewFavorites, archived: m.listx.viewArchived, all: "" };

  const Star = ({ rec }: { rec: RecordingSummary }) => (
    <button
      className={`text-base leading-none ${rec.favorite ? "text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"}`}
      title={rec.favorite ? m.listx.unstar : m.listx.star}
      aria-label={rec.favorite ? m.listx.unstar : m.listx.star}
      aria-pressed={rec.favorite}
      onClick={() => patchOne(rec, { favorite: !rec.favorite })}
    >
      {rec.favorite ? "★" : "☆"}
    </button>
  );

  const RowActions = ({ rec, compact }: { rec: RecordingSummary; compact?: boolean }) => (
    <div className={`flex shrink-0 gap-1 ${compact ? "" : "justify-end"}`}>
      {rec.status === "FAILED" && (
        <button className={`btn ${compact ? "px-2 py-1 text-xs" : ""}`} onClick={() => retry(rec)}>
          {m.list.retry}
        </button>
      )}
      <button
        className={`btn ${compact ? "px-2 py-1 text-xs" : ""}`}
        title={rec.archived ? m.listx.unarchive : m.listx.archive}
        aria-label={rec.archived ? m.listx.unarchive : m.listx.archive}
        onClick={() => patchOne(rec, { archived: !rec.archived })}
      >
        {rec.archived ? "⤴" : "🗄"}
      </button>
      <button className={`btn btn-danger ${compact ? "px-2 py-1 text-xs" : ""}`} onClick={() => remove(rec)}>
        {m.list.delete}
      </button>
    </div>
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{m.list.title}</h1>
        <Link href="/upload" className="btn btn-primary">
          {m.list.upload}
        </Link>
      </div>

      {error && <p className="mb-3 text-sm text-red-600">{fmt(m.errors.LIST_FAILED, { msg: error })}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-0.5 rounded-md border border-zinc-300 p-0.5 text-sm dark:border-zinc-700" role="tablist">
          {VIEWS.map((v) => (
            <Link
              key={v}
              href={buildHref(query, { view: v, page: 1 })}
              role="tab"
              aria-selected={view === v}
              className={`rounded px-2.5 py-1 ${view === v ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"}`}
            >
              {viewLabel[v]}
            </Link>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
          {m.listx.sort}
          <select className="input w-auto py-1" value={sort} onChange={(e) => router.push(buildHref(query, { sort: e.target.value as RecordingSort, page: 1 }))} aria-label={m.listx.sort}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {sortLabel[s]}
              </option>
            ))}
          </select>
        </label>
        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label={m.tags.filterTitle}>
            <Link href={buildHref(query, { tag: undefined, page: 1 })} className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${!query.tag ? "bg-blue-600 text-white ring-blue-600" : "text-zinc-600 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"}`}>
              {m.tags.filterAll}
            </Link>
            {tags.map((t) => (
              <Link
                key={t.tag}
                href={buildHref(query, { tag: t.tag, page: 1 })}
                className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ring-inset ${query.tag?.toLowerCase() === t.tag.toLowerCase() ? "bg-blue-600 text-white ring-blue-600" : "text-zinc-600 ring-zinc-300 hover:bg-zinc-100 dark:text-zinc-300 dark:ring-zinc-700 dark:hover:bg-zinc-800"}`}
              >
                {t.tag} <span className="opacity-60">{t.count}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm dark:border-blue-900 dark:bg-blue-950" data-testid="bulk-toolbar">
          <span className="font-medium">{fmt(m.listx.selected, { n: selected.size })}</span>
          <button className="btn py-1 text-xs" onClick={() => setDialog({ kind: "tag", action: "addTag" })} disabled={busy}>
            🏷 {m.listx.addTag}
          </button>
          <button className="btn py-1 text-xs" onClick={() => setDialog({ kind: "tag", action: "removeTag" })} disabled={busy}>
            {m.listx.removeTag}
          </button>
          <button className="btn py-1 text-xs" onClick={() => bulk("favorite")} disabled={busy}>
            ★ {m.listx.favorite}
          </button>
          <button className="btn py-1 text-xs" onClick={() => bulk(view === "archived" ? "unarchive" : "archive")} disabled={busy}>
            {view === "archived" ? `⤴ ${m.listx.unarchive}` : `🗄 ${m.listx.archive}`}
          </button>
          <button className="btn btn-danger py-1 text-xs" onClick={() => setDialog({ kind: "delete" })} disabled={busy}>
            {fmt(m.listx.deleteN, { n: selected.size })}
          </button>
          <button className="ml-auto text-xs text-zinc-500 hover:underline" onClick={() => setSelected(new Set())}>
            {m.listx.clear}
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="card p-10 text-center text-zinc-500">
          {m.list.empty}{" "}
          <Link href="/upload" className="text-blue-600 underline">
            {m.list.emptyCta}
          </Link>
          .
        </div>
      ) : (
        <>
          <div className="space-y-2 md:hidden">
            <label className="flex items-center gap-2 px-1 text-xs text-zinc-500">
              <input type="checkbox" checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((r) => r.id)) : new Set())} />
              {m.listx.selectAll}
            </label>
            {items.map((rec, i) => {
              const phase = phaseLabel(rec.phase, m);
              const err = errorLabel(rec.error, m);
              return (
                <div key={rec.id} data-row-index={i} className={`card p-3 ${selected.has(rec.id) ? "ring-2 ring-blue-400" : ""} ${cursor === i ? "outline outline-2 outline-blue-500" : ""}`}>
                  <div className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={selected.has(rec.id)} onChange={() => toggle(rec.id)} aria-label={rec.title} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Link href={`/recordings/${rec.id}`} className="block truncate font-medium hover:underline">
                          {rec.title}
                        </Link>
                        <Star rec={rec} />
                      </div>
                      {rec.tags.length > 0 && <TagChips tags={rec.tags} />}
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500">
                        <span>{formatDate(rec.createdAt, locale)}</span>
                        {rec.durationSec != null && <span>{formatDuration(rec.durationSec, m)}</span>}
                        {rec.speakerCount != null && <span>{rec.speakerCount} {m.list.speakers.toLowerCase()}</span>}
                        {rec.archived && <span>{m.listx.archivedBadge}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <StatusBadge status={rec.status} title={phase} progress={rec.progress} />
                      {(rec.status === "PROCESSING" || rec.status === "QUEUED") && phase && <div className="mt-1 text-xs text-zinc-500">{phase}</div>}
                      {rec.status === "FAILED" && err && (
                        <div className="mt-1 truncate text-xs text-red-600" title={err}>
                          {err}
                        </div>
                      )}
                    </div>
                    <RowActions rec={rec} compact />
                  </div>
                  {rec.status === "PROCESSING" && (
                    <div className="mt-2 h-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                      <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/60">
                <tr>
                  <th className="w-8 px-3 py-2">
                    <input type="checkbox" checked={allOnPage} onChange={(e) => setSelected(e.target.checked ? new Set(items.map((r) => r.id)) : new Set())} aria-label={m.listx.selectAll} />
                  </th>
                  <th className="w-6 px-1 py-2" />
                  <th className="px-4 py-2">{m.list.name}</th>
                  <th className="px-4 py-2">{m.list.date}</th>
                  <th className="px-4 py-2">{m.list.duration}</th>
                  <th className="px-4 py-2">{m.list.speakers}</th>
                  <th className="px-4 py-2">{m.list.state}</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {items.map((rec, i) => {
                  const phase = phaseLabel(rec.phase, m);
                  const err = errorLabel(rec.error, m);
                  return (
                    <tr
                      key={rec.id}
                      data-row-index={i}
                      aria-current={cursor === i ? "true" : undefined}
                      onClick={() => setCursor(i)}
                      className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${selected.has(rec.id) ? "bg-blue-50/60 dark:bg-blue-950/30" : ""} ${cursor === i ? "outline outline-2 -outline-offset-2 outline-blue-500" : ""}`}
                    >
                      <td className="px-3 py-2.5">
                        <input type="checkbox" checked={selected.has(rec.id)} onChange={() => toggle(rec.id)} aria-label={rec.title} />
                      </td>
                      <td className="px-1 py-2.5">
                        <Star rec={rec} />
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/recordings/${rec.id}`} className="font-medium hover:underline">
                          {rec.title}
                        </Link>
                        {rec.archived && <span className="ml-2 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-500 dark:bg-zinc-800">{m.listx.archivedBadge}</span>}
                        <div className="text-xs text-zinc-500">{rec.originalFilename}</div>
                        {rec.tags.length > 0 && <TagChips tags={rec.tags} />}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-zinc-600 dark:text-zinc-400">{formatDate(rec.createdAt, locale)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{formatDuration(rec.durationSec, m)}</td>
                      <td className="px-4 py-2.5">{rec.speakerCount ?? "–"}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={rec.status} title={phase} progress={rec.progress} />
                          {(rec.status === "PROCESSING" || rec.status === "QUEUED") && phase && <div className="text-xs text-zinc-500">{phase}</div>}
                          {rec.status === "PROCESSING" && (
                            <div className="h-1 w-32 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
                              <div className="h-full bg-blue-500 transition-all" style={{ width: `${rec.progress}%` }} />
                            </div>
                          )}
                          {rec.status === "FAILED" && err && (
                            <div className="max-w-xs truncate text-xs text-red-600" title={err}>
                              {err}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right">
                        <RowActions rec={rec} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 hidden text-xs text-zinc-400 md:block">{m.listx.keys}</p>
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm" data-testid="pagination">
              <Link aria-disabled={data.page <= 1} className={`btn ${data.page <= 1 ? "pointer-events-none opacity-40" : ""}`} href={buildHref(query, { page: data.page - 1 })}>
                ‹ {m.listx.prev}
              </Link>
              <span className="text-zinc-600 dark:text-zinc-300">{fmt(m.listx.page, { page: data.page, pages })}</span>
              <Link aria-disabled={data.page >= pages} className={`btn ${data.page >= pages ? "pointer-events-none opacity-40" : ""}`} href={buildHref(query, { page: data.page + 1 })}>
                {m.listx.next} ›
              </Link>
            </div>
          )}
        </>
      )}

      <Dialog
        open={dialog?.kind === "tag"}
        title={dialog?.kind === "tag" && dialog.action === "removeTag" ? m.listx.removeTag : m.listx.addTag}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-primary" disabled={!tagInput.trim() || busy} onClick={() => dialog?.kind === "tag" && bulk(dialog.action, tagInput.trim())}>
              {m.detail.confirm}
            </button>
          </>
        }
      >
        <input className="input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder={m.listx.tagPrompt} list="all-tags" onKeyDown={(e) => e.key === "Enter" && dialog?.kind === "tag" && tagInput.trim() && bulk(dialog.action, tagInput.trim())} />
        <datalist id="all-tags">
          {tags.map((t) => (
            <option key={t.tag} value={t.tag} />
          ))}
        </datalist>
      </Dialog>
      <Dialog
        open={dialog?.kind === "delete"}
        title={m.detail.deleteTitle}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => bulk("delete")}>
              {m.detail.confirm}
            </button>
          </>
        }
      >
        <p>{fmt(m.listx.confirmDeleteN, { n: selected.size })}</p>
      </Dialog>
    </div>
  );
}
