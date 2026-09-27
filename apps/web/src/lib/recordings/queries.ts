/** Listing, paging, tag counts and library totals. Server-side only. */
import { desc } from "drizzle-orm";
import type { RecordingListQuery, RecordingPage, RecordingSummary, TagCount } from "@note-taker/shared";
import { db, schema } from "@/lib/db";
import { toSummary } from "./core";
import type { SummaryRow } from "./core";

const { recordings } = schema;

function selectSummaryRows(): SummaryRow[] {
  // Only what the overview needs: no segments, notes, embeddings or suggestions
  return db
    .select({
      id: recordings.id,
      title: recordings.title,
      originalFilename: recordings.originalFilename,
      language: recordings.language,
      detectedLanguage: recordings.detectedLanguage,
      status: recordings.status,
      workerStatus: recordings.workerStatus,
      progress: recordings.progress,
      phase: recordings.phase,
      durationSec: recordings.durationSec,
      speakerCount: recordings.speakerCount,
      error: recordings.error,
      warning: recordings.warning,
      tags: recordings.tags,
      favorite: recordings.favorite,
      archived: recordings.archived,
      ownerTokenId: recordings.ownerTokenId,
      createdAt: recordings.createdAt,
      updatedAt: recordings.updatedAt,
    })
    .from(recordings)
    .orderBy(desc(recordings.createdAt))
    .all();
}

const collator = new Intl.Collator("cs", { sensitivity: "base", numeric: true });

/** Filtered + sorted summaries. Archived recordings are hidden unless the view asks for them. */
export function listRecordings(query: RecordingListQuery = {}): RecordingSummary[] {
  const tag = query.tag?.trim().toLowerCase();
  const view = query.view ?? "active";
  let rows = selectSummaryRows().filter((r) => {
    if (query.ownerTokenId && r.ownerTokenId !== query.ownerTokenId) return false;
    if (tag && !(r.tags ?? []).some((t) => t.toLowerCase() === tag)) return false;
    if (view === "active") return !r.archived;
    if (view === "favorites") return r.favorite && !r.archived;
    if (view === "archived") return r.archived;
    return true;
  });
  const sort = query.sort ?? "newest";
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case "oldest":
        return a.createdAt.localeCompare(b.createdAt);
      case "title":
        return collator.compare(a.title, b.title);
      case "longest":
        return (b.durationSec ?? -1) - (a.durationSec ?? -1);
      case "shortest":
        return (a.durationSec ?? Infinity) - (b.durationSec ?? Infinity);
      default:
        return b.createdAt.localeCompare(a.createdAt);
    }
  });
  return rows.map(toSummary);
}

export function pageRecordings(query: RecordingListQuery = {}): RecordingPage {
  const all = listRecordings(query);
  const pageSize = Math.min(200, Math.max(5, query.pageSize ?? 25));
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(pages, Math.max(1, query.page ?? 1));
  return { items: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
}

/** Library-wide counts from the web database (independent of the worker's own metrics). */
export function getLibraryStats(): { recordings: number; completed: number; failed: number; audioSeconds: number; speakersNamed: number } {
  const rows = db.select({ status: recordings.status, durationSec: recordings.durationSec, speakerNames: recordings.speakerNames }).from(recordings).all();
  return {
    recordings: rows.length,
    completed: rows.filter((r) => r.status === "COMPLETED").length,
    failed: rows.filter((r) => r.status === "FAILED").length,
    audioSeconds: rows.reduce((a, r) => a + (r.durationSec ?? 0), 0),
    speakersNamed: rows.reduce((a, r) => a + Object.keys(r.speakerNames ?? {}).length, 0),
  };
}

/** Distinct tags with usage counts, most used first. */
export function listTags(): TagCount[] {
  const counts = new Map<string, number>();
  for (const r of db.select({ tags: recordings.tags }).from(recordings).all()) {
    for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
