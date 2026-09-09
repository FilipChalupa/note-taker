/**
 * Client-side persistence of an in-progress browser recording (IndexedDB), so a crash or a closed
 * tab does not lose the audio. Chunks are appended as MediaRecorder emits them (1 s timeslices).
 */
export interface RecordingSession {
  id: string;
  startedAt: string;
  title: string;
  mime: string;
  source: string;
}

const DB_NAME = "note-taker-recorder";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("chunks")) {
        const chunks = db.createObjectStore("chunks", { autoIncrement: true });
        chunks.createIndex("bySession", "sessionId");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, stores: string | string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result: T | undefined;
    const req = run(t);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result as T);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const recordingStore = {
  available(): boolean {
    return typeof indexedDB !== "undefined";
  },

  async createSession(session: RecordingSession): Promise<void> {
    const db = await openDb();
    await tx(db, "sessions", "readwrite", (t) => t.objectStore("sessions").put(session));
    db.close();
  },

  async appendChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
    const db = await openDb();
    await tx(db, "chunks", "readwrite", (t) => t.objectStore("chunks").add({ sessionId, seq, blob }));
    db.close();
  },

  async listSessions(): Promise<Array<RecordingSession & { chunks: number; bytes: number }>> {
    const db = await openDb();
    const sessions = await tx<RecordingSession[]>(db, "sessions", "readonly", (t) => t.objectStore("sessions").getAll());
    const out = [];
    for (const s of sessions) {
      const chunks = await tx<Array<{ blob: Blob }>>(db, "chunks", "readonly", (t) => t.objectStore("chunks").index("bySession").getAll(s.id));
      out.push({ ...s, chunks: chunks.length, bytes: chunks.reduce((a, c) => a + c.blob.size, 0) });
    }
    db.close();
    return out.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  },

  async loadBlob(sessionId: string): Promise<Blob | null> {
    const db = await openDb();
    const session = await tx<RecordingSession | undefined>(db, "sessions", "readonly", (t) => t.objectStore("sessions").get(sessionId));
    const chunks = await tx<Array<{ seq: number; blob: Blob }>>(db, "chunks", "readonly", (t) => t.objectStore("chunks").index("bySession").getAll(sessionId));
    db.close();
    if (!session || chunks.length === 0) return null;
    chunks.sort((a, b) => a.seq - b.seq);
    return new Blob(chunks.map((c) => c.blob), { type: session.mime });
  },

  async deleteSession(sessionId: string): Promise<void> {
    const db = await openDb();
    await tx(db, ["sessions", "chunks"], "readwrite", (t) => {
      t.objectStore("sessions").delete(sessionId);
      const idx = t.objectStore("chunks").index("bySession");
      const req = idx.openKeyCursor(sessionId);
      req.onsuccess = () => {
        const cur = req.result;
        if (cur) {
          t.objectStore("chunks").delete(cur.primaryKey);
          cur.continue();
        }
      };
    });
    db.close();
  },
};
