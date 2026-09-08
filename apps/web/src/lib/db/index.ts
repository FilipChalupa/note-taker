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
  min_speakers INTEGER,
  max_speakers INTEGER,
  status TEXT NOT NULL DEFAULT 'QUEUED',
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
  return drizzle(sqlite, { schema });
}

// Cache on globalThis so Next.js dev HMR does not open a new handle on every reload
const g = globalThis as unknown as { __noteTakerDb?: Db };
export const db: Db = g.__noteTakerDb ?? (g.__noteTakerDb = open());
export { schema };
