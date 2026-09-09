import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { config } from "@/lib/config";
import * as schema from "./schema";

export type Db = BetterSQLite3Database<typeof schema>;

const DDL = `
CREATE TABLE IF NOT EXISTS recordings (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  original_path TEXT NOT NULL,
  audio_path TEXT,
  language TEXT NOT NULL DEFAULT 'cs',
  hints TEXT,
  min_speakers INTEGER,
  max_speakers INTEGER,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  task_kind TEXT NOT NULL DEFAULT 'transcribe',
  worker_task_id TEXT,
  worker_status TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  phase TEXT,
  error TEXT,
  warning TEXT,
  dispatch_attempts INTEGER NOT NULL DEFAULT 0,
  duration_sec REAL,
  detected_language TEXT,
  speaker_count INTEGER,
  speakers TEXT NOT NULL DEFAULT '[]',
  speaker_names TEXT NOT NULL DEFAULT '{}',
  segments TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS recordings_status_idx ON recordings(status);
CREATE INDEX IF NOT EXISTS recordings_created_idx ON recordings(created_at DESC);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);
`;

// Full-text index over transcripts (title + all segment text). Diacritics are folded so "priorita"
// also finds "priorít"; body is rebuilt from the recordings table whenever a transcript changes.
const FTS_DDL = `
CREATE VIRTUAL TABLE IF NOT EXISTS recordings_fts USING fts5(
  recording_id UNINDEXED,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

function open(): Db {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, "db.sqlite");
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.exec(DDL);
  // Lightweight forward migrations for databases created by older versions
  const cols = new Set((sqlite.prepare("PRAGMA table_info(recordings)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("warning")) sqlite.exec("ALTER TABLE recordings ADD COLUMN warning TEXT");
  if (!cols.has("task_kind")) sqlite.exec("ALTER TABLE recordings ADD COLUMN task_kind TEXT NOT NULL DEFAULT 'transcribe'");
  if (!cols.has("hints")) sqlite.exec("ALTER TABLE recordings ADD COLUMN hints TEXT");
  const hadFts = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recordings_fts'").get();
  sqlite.exec(FTS_DDL);
  if (!hadFts) {
    // First run with FTS: index existing transcripts
    const rows = sqlite.prepare("SELECT id, title, segments FROM recordings WHERE status = 'COMPLETED'").all() as { id: string; title: string; segments: string }[];
    const ins = sqlite.prepare("INSERT INTO recordings_fts (recording_id, title, body) VALUES (?, ?, ?)");
    for (const r of rows) {
      let body = "";
      try {
        body = (JSON.parse(r.segments) as { text: string }[]).map((x) => x.text).join(" ");
      } catch {
        /* ignore */
      }
      ins.run(r.id, r.title, body);
    }
  }
  return drizzle(sqlite, { schema });
}

// Cache on globalThis so Next.js dev HMR does not open a new handle on every reload
const g = globalThis as unknown as { __noteTakerDb?: Db };
export const db: Db = g.__noteTakerDb ?? (g.__noteTakerDb = open());
export { schema };

/** Raw better-sqlite3 handle for FTS queries that drizzle cannot express. */
export function rawDb(): Database.Database {
  return (db as unknown as { $client: Database.Database }).$client;
}
