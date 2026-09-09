import fs from "node:fs";
import path from "node:path";
import type { StorageInfo } from "@note-taker/shared";
import { config } from "@/lib/config";

function sizeOf(p: string): number {
  try {
    return fs.statSync(p).size;
  } catch {
    return 0;
  }
}

/** Disk usage of DATA_DIR split by kind of file, plus free space on the volume. */
export function getStorageInfo(): StorageInfo {
  const recDir = path.join(config.dataDir, "recordings");
  let originalsBytes = 0;
  let audioBytes = 0;
  let recordings = 0;
  if (fs.existsSync(recDir)) {
    for (const id of fs.readdirSync(recDir)) {
      const dir = path.join(recDir, id);
      let entries: string[];
      try {
        entries = fs.readdirSync(dir);
      } catch {
        continue;
      }
      recordings += 1;
      for (const f of entries) {
        const size = sizeOf(path.join(dir, f));
        if (f.startsWith("original")) originalsBytes += size;
        else if (f.startsWith("audio")) audioBytes += size;
      }
    }
  }
  const databaseBytes = ["db.sqlite", "db.sqlite-wal", "db.sqlite-shm"].reduce((a, f) => a + sizeOf(path.join(config.dataDir, f)), 0);

  let volumeFreeBytes: number | null = null;
  let volumeTotalBytes: number | null = null;
  try {
    const st = fs.statfsSync(config.dataDir);
    volumeFreeBytes = Number(st.bavail) * Number(st.bsize);
    volumeTotalBytes = Number(st.blocks) * Number(st.bsize);
  } catch {
    /* statfs unavailable */
  }
  return {
    dataDir: config.dataDir,
    recordings,
    originalsBytes,
    audioBytes,
    databaseBytes,
    totalBytes: originalsBytes + audioBytes + databaseBytes,
    volumeFreeBytes,
    volumeTotalBytes,
  };
}
