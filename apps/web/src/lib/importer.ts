/**
 * Watch folder import: media files dropped into IMPORT_DIR become recordings.
 * A file is imported once its size has been stable for two consecutive scans (upload finished).
 * Called by the poller; safe to call often.
 */
import fs from "node:fs";
import path from "node:path";
import type { ImportDirInfo } from "@note-taker/shared";
import { config, SUPPORTED_MEDIA } from "@/lib/config";
import { createRecordingFromPath } from "@/lib/recordings";

// Kept on globalThis: Next.js bundles this module separately for the poller and for API routes.
const g = globalThis as unknown as { __noteTakerImport?: { seen: Map<string, { size: number; mtimeMs: number; scans: number }>; imported: number } };
const state = (g.__noteTakerImport ??= { seen: new Map(), imported: 0 });
const seen = state.seen;

function candidates(): string[] {
  const dir = config.importDir;
  if (!dir || !fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith(".") && SUPPORTED_MEDIA.test(f) && !f.endsWith(".failed"))
    .map((f) => path.join(dir, f))
    .filter((p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

export function scanImportDir(): void {
  const files = candidates();
  const present = new Set(files);
  for (const key of [...seen.keys()]) if (!present.has(key)) seen.delete(key);

  for (const file of files) {
    const st = fs.statSync(file);
    const prev = seen.get(file);
    if (!prev || prev.size !== st.size || prev.mtimeMs !== st.mtimeMs) {
      seen.set(file, { size: st.size, mtimeMs: st.mtimeMs, scans: 1 });
      continue;
    }
    prev.scans += 1;
    // stable for two scans and not modified in the last 3 s -> import
    if (prev.scans < 2 || Date.now() - st.mtimeMs < 3000) continue;
    if (st.size === 0) {
      fs.renameSync(file, `${file}.failed`);
      seen.delete(file);
      continue;
    }
    try {
      const rec = createRecordingFromPath(file, { language: config.importLanguage, tags: ["import"] });
      state.imported += 1;
      console.log(`[import] ${path.basename(file)} -> recording ${rec.id}`);
    } catch (err) {
      console.error(`[import] failed for ${file}:`, (err as Error).message);
      try {
        fs.renameSync(file, `${file}.failed`);
      } catch {
        /* ignore */
      }
    }
    seen.delete(file);
  }
}

export function importDirInfo(): ImportDirInfo {
  return {
    path: config.importDir,
    enabled: Boolean(config.importDir && fs.existsSync(config.importDir)),
    pending: candidates().length,
    imported: state.imported,
  };
}
