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
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
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
  speaker_embeddings TEXT,
  speaker_suggestions TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS voices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  embedding TEXT NOT NULL,
  samples TEXT NOT NULL DEFAULT '[]',
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
CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  scopes TEXT NOT NULL DEFAULT '[]',
  tag_filter TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  last_used_at TEXT,
  revoked_at TEXT,
  requests INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  token_id TEXT,
  token_name TEXT,
  action TEXT NOT NULL,
  recording_id TEXT,
  status INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit_log(at DESC);
CREATE TABLE IF NOT EXISTS intake_imports (
  intake_id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL,
  collected_at TEXT NOT NULL
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
  // Lightweight forward migrations for databases created by older versions.
  // Several processes (and Next.js build workers) can open the database at once, so a column another
  // process just added is not an error.
  const addColumn = (name: string, ddl: string) => {
    const cols = new Set((sqlite.prepare("PRAGMA table_info(recordings)").all() as { name: string }[]).map((c) => c.name));
    if (cols.has(name)) return;
    try {
      sqlite.exec(`ALTER TABLE recordings ADD COLUMN ${ddl}`);
    } catch (err) {
      if (!/duplicate column name/i.test((err as Error).message)) throw err;
    }
  };
  addColumn("warning", "warning TEXT");
  addColumn("task_kind", "task_kind TEXT NOT NULL DEFAULT 'transcribe'");
  addColumn("hints", "hints TEXT");
  addColumn("tags", "tags TEXT NOT NULL DEFAULT '[]'");
  addColumn("notes", "notes TEXT");
  addColumn("favorite", "favorite INTEGER NOT NULL DEFAULT 0");
  addColumn("archived", "archived INTEGER NOT NULL DEFAULT 0");
  addColumn("speaker_embeddings", "speaker_embeddings TEXT");
  addColumn("speaker_suggestions", "speaker_suggestions TEXT NOT NULL DEFAULT '{}'");
  addColumn("owner_token_id", "owner_token_id TEXT");
  const hadFts = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recordings_fts'").get();
  sqlite.exec(FTS_DDL);
  if (!hadFts && (sqlite.prepare("SELECT COUNT(*) AS n FROM recordings_fts").get() as { n: number }).n === 0) {
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
