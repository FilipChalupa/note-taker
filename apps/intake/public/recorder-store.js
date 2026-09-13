// IndexedDB persistence of an in-progress recording: a crash or closed tab does not lose the audio.
const DB = "intake-recorder";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("sessions", { keyPath: "id" });
      db.createObjectStore("chunks", { autoIncrement: true }).createIndex("bySession", "sessionId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, stores, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode);
    let result;
    const req = fn(t);
    if (req) req.onsuccess = () => (result = req.result);
    t.oncomplete = () => resolve(result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const recorderStore = {
  available: () => typeof indexedDB !== "undefined",
  async createSession(session) {
    const db = await open();
    await run(db, "sessions", "readwrite", (t) => t.objectStore("sessions").put(session));
    db.close();
  },
  async appendChunk(sessionId, seq, blob) {
    const db = await open();
    await run(db, "chunks", "readwrite", (t) => t.objectStore("chunks").add({ sessionId, seq, blob }));
    db.close();
  },
  async listSessions() {
    const db = await open();
    const sessions = await run(db, "sessions", "readonly", (t) => t.objectStore("sessions").getAll());
    const out = [];
    for (const s of sessions) {
      const chunks = await run(db, "chunks", "readonly", (t) => t.objectStore("chunks").index("bySession").getAll(s.id));
      if (chunks.length) out.push({ ...s, chunks: chunks.length });
    }
    db.close();
    return out;
  },
  async loadBlob(sessionId) {
    const db = await open();
    const session = await run(db, "sessions", "readonly", (t) => t.objectStore("sessions").get(sessionId));
    const chunks = await run(db, "chunks", "readonly", (t) => t.objectStore("chunks").index("bySession").getAll(sessionId));
    db.close();
    if (!session || !chunks.length) return null;
    chunks.sort((a, b) => a.seq - b.seq);
    return { session, blob: new Blob(chunks.map((c) => c.blob), { type: session.mime }) };
  },
  async deleteSession(sessionId) {
    const db = await open();
    await run(db, ["sessions", "chunks"], "readwrite", (t) => {
      t.objectStore("sessions").delete(sessionId);
      const req = t.objectStore("chunks").index("bySession").openKeyCursor(sessionId);
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
