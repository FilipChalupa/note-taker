/**
 * Filesystem store.
 *   <data>/incoming/<id>/{meta.json,data}  uploads in progress
 *   <data>/ready/<id>/{meta.json,data}     complete, waiting for the collector
 * Nothing is kept after the collector acknowledges an item.
 */
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

export class StoreError extends Error {
  constructor(code, status, extra = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.extra = extra;
  }
}

const ID = /^[a-f0-9]{32}$/;

export class Store {
  constructor(dir) {
    this.dir = dir;
    this.incomingDir = path.join(dir, "incoming");
    this.readyDir = path.join(dir, "ready");
    this.busy = new Set();
    fs.mkdirSync(this.incomingDir, { recursive: true });
    fs.mkdirSync(this.readyDir, { recursive: true });
  }

  static validId(id) {
    return typeof id === "string" && ID.test(id);
  }

  async #readMeta(dir) {
    try {
      return JSON.parse(await fsp.readFile(path.join(dir, "meta.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async #writeMeta(dir, meta) {
    const tmp = path.join(dir, "meta.json.tmp");
    await fsp.writeFile(tmp, JSON.stringify(meta));
    await fsp.rename(tmp, path.join(dir, "meta.json"));
  }

  async create(meta) {
    const id = randomBytes(16).toString("hex");
    const dir = path.join(this.incomingDir, id);
    await fsp.mkdir(dir);
    await fsp.writeFile(path.join(dir, "data"), "");
    await this.#writeMeta(dir, { ...meta, id, createdAt: new Date().toISOString() });
    return id;
  }

  /** Incomplete upload with the number of bytes received so far, or null. */
  async getIncoming(id) {
    if (!Store.validId(id)) return null;
    const dir = path.join(this.incomingDir, id);
    const meta = await this.#readMeta(dir);
    if (!meta) return null;
    const st = await fsp.stat(path.join(dir, "data")).catch(() => null);
    return st ? { ...meta, received: st.size } : null;
  }

  /** Append one chunk. `offset` must equal the bytes already received, which makes retries and resume safe. */
  async appendChunk(id, offset, stream, maxChunkBytes) {
    const up = await this.getIncoming(id);
    if (!up) throw new StoreError("NOT_FOUND", 404);
    if (this.busy.has(id)) throw new StoreError("BUSY", 409, { received: up.received });
    if (offset !== up.received) throw new StoreError("OFFSET_MISMATCH", 409, { received: up.received });
    const limit = Math.min(maxChunkBytes, up.size - up.received);
    const file = path.join(this.incomingDir, id, "data");
    this.busy.add(id);
    let written = 0;
    try {
      const counter = new Transform({
        transform(chunk, _enc, cb) {
          written += chunk.length;
          if (written > limit) cb(new StoreError(written > maxChunkBytes ? "CHUNK_TOO_LARGE" : "EXCEEDS_DECLARED_SIZE", 413));
          else cb(null, chunk);
        },
      });
      await pipeline(stream, counter, fs.createWriteStream(file, { flags: "a" }));
      return up.received + written;
    } catch (err) {
      // roll back a partial chunk so the client can retry from the same offset
      await fsp.truncate(file, up.received).catch(() => {});
      if (err instanceof StoreError) {
        err.extra = { received: up.received };
        throw err;
      }
      throw new StoreError("UPLOAD_INTERRUPTED", 400, { received: up.received });
    } finally {
      this.busy.delete(id);
    }
  }

  async complete(id) {
    const up = await this.getIncoming(id);
    if (!up) throw new StoreError("NOT_FOUND", 404);
    if (this.busy.has(id)) throw new StoreError("BUSY", 409, { received: up.received });
    if (up.received !== up.size) throw new StoreError("INCOMPLETE", 409, { received: up.received });
    this.busy.add(id);
    try {
      const dir = path.join(this.incomingDir, id);
      const hash = createHash("sha256");
      await pipeline(fs.createReadStream(path.join(dir, "data")), hash);
      const { received: _received, ...meta } = up;
      await this.#writeMeta(dir, { ...meta, sha256: hash.digest("hex"), completedAt: new Date().toISOString() });
      await fsp.rename(dir, path.join(this.readyDir, id));
    } finally {
      this.busy.delete(id);
    }
  }

  async cancel(id) {
    if (!Store.validId(id) || this.busy.has(id)) return false;
    const dir = path.join(this.incomingDir, id);
    if (!fs.existsSync(dir)) return false;
    await fsp.rm(dir, { recursive: true, force: true });
    return true;
  }

  async listReady() {
    const out = [];
    for (const id of await fsp.readdir(this.readyDir).catch(() => [])) {
      if (!Store.validId(id)) continue;
      const meta = await this.#readMeta(path.join(this.readyDir, id));
      if (meta) out.push(meta);
    }
    return out.sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  }

  async getReady(id) {
    if (!Store.validId(id)) return null;
    return this.#readMeta(path.join(this.readyDir, id));
  }

  readyFile(id) {
    return path.join(this.readyDir, id, "data");
  }

  async deleteReady(id) {
    if (!Store.validId(id)) return false;
    const dir = path.join(this.readyDir, id);
    if (!fs.existsSync(dir)) return false;
    await fsp.rm(dir, { recursive: true, force: true });
    return true;
  }

  /** Bytes reserved by incomplete uploads (declared size) plus ready files. */
  async usage() {
    let incompleteBytes = 0;
    let incompleteCount = 0;
    for (const id of await fsp.readdir(this.incomingDir).catch(() => [])) {
      const meta = await this.#readMeta(path.join(this.incomingDir, id));
      if (meta) {
        incompleteBytes += meta.size;
        incompleteCount += 1;
      }
    }
    const ready = await this.listReady();
    return { incompleteBytes, incompleteCount, readyBytes: ready.reduce((a, m) => a + m.size, 0), readyCount: ready.length };
  }

  /** Remove abandoned uploads and items nobody collected in time. Returns the number of removed entries. */
  async sweep({ now = Date.now(), incompleteTtlMs, readyTtlMs }) {
    let removed = 0;
    for (const [base, ttl, field] of [
      [this.incomingDir, incompleteTtlMs, "createdAt"],
      [this.readyDir, readyTtlMs, "completedAt"],
    ]) {
      for (const id of await fsp.readdir(base).catch(() => [])) {
        if (this.busy.has(id)) continue;
        const dir = path.join(base, id);
        const meta = await this.#readMeta(dir);
        let ts = meta ? Date.parse(meta[field]) : 0;
        // for incomplete uploads the last received chunk counts, not the start
        if (base === this.incomingDir) {
          const st = await fsp.stat(path.join(dir, "data")).catch(() => null);
          if (st) ts = Math.max(ts, st.mtimeMs);
        }
        if (!meta || now - ts > ttl) {
          await fsp.rm(dir, { recursive: true, force: true });
          removed += 1;
        }
      }
    }
    return removed;
  }
}
