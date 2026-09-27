/** Full-text index (FTS5) over titles, tags, notes and transcripts. Server-side only. */
import type { SearchHit } from "@note-taker/shared";
import { rawDb } from "@/lib/db";
import { getRecordingRow } from "./core";

export function indexRecording(id: string): void {
  const row = getRecordingRow(id);
  const sql = rawDb();
  sql.prepare("DELETE FROM recordings_fts WHERE recording_id = ?").run(id);
  if (!row || row.status !== "COMPLETED") return;
  const body = [(row.tags ?? []).join(" "), row.notes ?? "", ...(row.segments ?? []).map((s) => s.text)].filter(Boolean).join(" ");
  sql.prepare("INSERT INTO recordings_fts (recording_id, title, body) VALUES (?, ?, ?)").run(id, row.title, body);
}

/** Full-text search over titles and transcripts. Terms are AND-ed, each matched as a prefix. */
export function searchRecordings(query: string, limit = 30): SearchHit[] {
  const terms = query
    .split(/\s+/)
    .map((t) => t.replace(/["*()]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 8);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t}"*`).join(" ");
  const rows = rawDb()
    .prepare(
      `SELECT f.recording_id AS id, r.title, r.created_at AS createdAt, r.duration_sec AS durationSec,
              snippet(recordings_fts, 2, '\u0001', '\u0002', '…', 18) AS snippet
         FROM recordings_fts f JOIN recordings r ON r.id = f.recording_id
        WHERE recordings_fts MATCH ?
        ORDER BY bm25(recordings_fts, 5.0, 1.0)
        LIMIT ?`,
    )
    .all(match, limit) as SearchHit[];
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return rows.map((r) => ({ ...r, snippet: esc(r.snippet).replace(/\u0001/g, "<mark>").replace(/\u0002/g, "</mark>") }));
}
