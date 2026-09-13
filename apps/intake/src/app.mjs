/**
 * Intake HTTP service.
 *
 * Public side: a static upload/record page and a chunked, resumable upload API. It reveals only upload limits and
 * whether an access code is required. It never exposes anything about stored items beyond an uploader's own
 * in-progress upload, addressed by an unguessable id.
 *
 * Collector side (/collect/v1/*, bearer token): the internal web app pulls completed items and acknowledges them.
 * The intake service never initiates connections and knows no internal address.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LANGUAGES, SUPPORTED_MEDIA } from "./config.mjs";
import { Store, StoreError } from "./store.mjs";

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const STATIC = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/recorder-store.js", ["recorder-store.js", "text/javascript; charset=utf-8"]],
  ["/app.css", ["app.css", "text/css; charset=utf-8"]],
  ["/icon.svg", ["icon.svg", "image/svg+xml"]],
  ["/manifest.webmanifest", ["manifest.webmanifest", "application/manifest+json"]],
]);

export const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "microphone=(self), display-capture=(self), camera=(), geolocation=()",
};

const digest = (s) => createHash("sha256").update(String(s)).digest();
const safeEqual = (a, b) => a != null && b != null && timingSafeEqual(digest(a), digest(b));

function send(res, status, body, headers = {}) {
  const isJson = body !== undefined && typeof body !== "string" && !Buffer.isBuffer(body);
  const payload = body === undefined ? "" : isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Cache-Control": "no-store",
    ...(isJson ? { "Content-Type": "application/json; charset=utf-8" } : {}),
    ...headers,
  });
  res.end(payload);
}

const fail = (res, status, code, extra = {}) => send(res, status, { error: code, ...extra });

async function readJson(req, limit = 16 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new StoreError("BODY_TOO_LARGE", 413);
    chunks.push(chunk);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new StoreError("INVALID_JSON", 400);
  }
}

/** Sliding window rate limiter per key. */
export class RateLimiter {
  constructor(limit, windowMs = 3600e3) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }
  take(key, now = Date.now()) {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  prune(now = Date.now()) {
    for (const [k, list] of this.hits) {
      const keep = list.filter((t) => now - t < this.windowMs);
      if (keep.length) this.hits.set(k, keep);
      else this.hits.delete(k);
    }
  }
}

// ASCII control characters are stripped from free text; multi-line notes keep newlines
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");
const CONTROL_EXCEPT_NEWLINE = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f]", "g");
const cleanText = (v, max) => (typeof v === "string" ? v.replace(CONTROL_CHARS, "").trim().slice(0, max) : "");
const cleanMultiline = (v, max) =>
  typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(CONTROL_EXCEPT_NEWLINE, "").trim().slice(0, max) : "";
const cleanFilename = (v) => cleanText(v, 200).replace(/[\\/]/g, "_").replace(/^\.+/, "") || "recording";

export function createIntake(config) {
  const store = new Store(config.dataDir);
  const uploadLimiter = new RateLimiter(config.rateLimitPerHour);
  const failLimiter = new RateLimiter(20);
  const log = (...args) => {
    if (!config.quiet) console.log("[intake]", ...args);
  };

  const clientIp = (req) => {
    if (config.trustProxy) {
      const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
      if (fwd) return fwd;
    }
    return req.socket.remoteAddress ?? "unknown";
  };

  /** Returns true when the request may proceed; otherwise it has already been answered. */
  const checkCode = (req, res) => {
    if (!config.uploadCode) return true;
    if (safeEqual(req.headers["x-upload-code"], config.uploadCode)) return true;
    if (!failLimiter.take(`code:${clientIp(req)}`)) {
      fail(res, 429, "TOO_MANY_ATTEMPTS");
      return false;
    }
    fail(res, 401, "CODE_REQUIRED");
    return false;
  };

  // ------------------------------------------------------------------ public
  async function publicRoutes(req, res, url) {
    const { pathname } = url;
    const method = req.method ?? "GET";

    if (pathname === "/healthz" && method === "GET") return send(res, 200, "ok", { "Content-Type": "text/plain" });

    if ((method === "GET" || method === "HEAD") && STATIC.has(pathname)) {
      const [file, type] = STATIC.get(pathname);
      const body = await fsp.readFile(path.join(PUBLIC_DIR, file));
      const cache = file === "index.html" ? "no-cache" : "public, max-age=300";
      return send(res, 200, method === "HEAD" ? "" : body, { "Content-Type": type, "Cache-Control": cache });
    }

    if (pathname === "/api/config" && method === "GET") {
      return send(res, 200, {
        title: config.title,
        codeRequired: Boolean(config.uploadCode),
        maxBytes: config.maxUploadBytes,
        chunkBytes: config.chunkBytes,
        defaultLanguage: config.defaultLanguage,
        languages: LANGUAGES,
      });
    }

    if (pathname === "/api/code" && method === "POST") {
      if (!checkCode(req, res)) return;
      return send(res, 204);
    }

    if (pathname === "/api/uploads" && method === "POST") {
      if (!checkCode(req, res)) return;
      const body = await readJson(req);
      const filename = cleanFilename(body.filename);
      const mime = cleanText(body.mime, 100);
      const size = Number(body.size);
      if (!Number.isInteger(size) || size <= 0) return fail(res, 400, "INVALID_SIZE");
      if (size > config.maxUploadBytes) return fail(res, 413, "FILE_TOO_LARGE", { maxBytes: config.maxUploadBytes });
      if (!SUPPORTED_MEDIA.test(filename) && !/^(audio|video)\//.test(mime)) return fail(res, 415, "UNSUPPORTED_TYPE");
      const language = LANGUAGES.includes(body.language) ? body.language : config.defaultLanguage;
      const usage = await store.usage();
      if (usage.incompleteBytes + usage.readyBytes + size > config.maxPendingBytes) return fail(res, 507, "STORAGE_FULL");
      if (!uploadLimiter.take(clientIp(req))) return fail(res, 429, "RATE_LIMITED");
      const id = await store.create({
        filename,
        mime,
        size,
        title: cleanText(body.title, 200).replace(/\s+/g, " "),
        note: cleanMultiline(body.note, 5000),
        language,
      });
      log(`upload started ${id.slice(0, 8)} (${size} bytes)`);
      return send(res, 201, { id, received: 0, chunkBytes: config.chunkBytes });
    }

    const m = /^\/api\/uploads\/([^/]+)(\/complete)?$/.exec(pathname);
    if (m) {
      const [, id, complete] = m;
      if (!Store.validId(id)) return fail(res, 404, "NOT_FOUND");
      if (!checkCode(req, res)) return;

      if (!complete && method === "GET") {
        const up = await store.getIncoming(id);
        return up ? send(res, 200, { id, size: up.size, received: up.received }) : fail(res, 404, "NOT_FOUND");
      }
      if (!complete && method === "PUT") {
        const offset = Number(url.searchParams.get("offset"));
        if (!Number.isInteger(offset) || offset < 0) return fail(res, 400, "INVALID_OFFSET");
        const declared = Number(req.headers["content-length"]);
        if (Number.isFinite(declared) && declared > config.chunkBytes) return fail(res, 413, "CHUNK_TOO_LARGE");
        const received = await store.appendChunk(id, offset, req, config.chunkBytes);
        return send(res, 200, { id, received });
      }
      if (!complete && method === "DELETE") {
        await store.cancel(id);
        return send(res, 204);
      }
      if (complete && method === "POST") {
        await store.complete(id);
        log(`upload complete ${id.slice(0, 8)}`);
        return send(res, 200, { ok: true, reference: id.slice(0, 8).toUpperCase() });
      }
      return fail(res, 405, "METHOD_NOT_ALLOWED");
    }

    return fail(res, 404, "NOT_FOUND");
  }

  // --------------------------------------------------------------- collector
  async function collectRoutes(req, res, url) {
    if (!config.collectToken) return fail(res, 404, "NOT_FOUND");
    const auth = String(req.headers.authorization ?? "");
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!safeEqual(token, config.collectToken)) {
      if (!failLimiter.take(`collect:${clientIp(req)}`)) return fail(res, 429, "TOO_MANY_ATTEMPTS");
      return fail(res, 401, "UNAUTHORIZED");
    }
    const { pathname } = url;
    const method = req.method ?? "GET";

    if (pathname === "/collect/v1/status" && method === "GET") {
      return send(res, 200, { ok: true, ...(await store.usage()) });
    }
    if (pathname === "/collect/v1/items" && method === "GET") {
      return send(res, 200, { items: await store.listReady() });
    }
    const m = /^\/collect\/v1\/items\/([^/]+)(\/file)?$/.exec(pathname);
    if (m) {
      const [, id, file] = m;
      const meta = await store.getReady(id);
      if (!meta) return fail(res, 404, "NOT_FOUND");
      if (file && method === "GET") {
        res.writeHead(200, {
          ...SECURITY_HEADERS,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(meta.size),
          "X-Content-SHA256": meta.sha256,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(store.readyFile(id)).pipe(res);
        return;
      }
      if (!file && method === "GET") return send(res, 200, meta);
      if (!file && method === "DELETE") {
        await store.deleteReady(id);
        log(`collected ${id.slice(0, 8)}`);
        return send(res, 204);
      }
      return fail(res, 405, "METHOD_NOT_ALLOWED");
    }
    return fail(res, 404, "NOT_FOUND");
  }

  const wrap = (routes) => async (req, res) => {
    let url;
    try {
      url = new URL(req.url ?? "/", "http://intake.local");
    } catch {
      return fail(res, 400, "BAD_REQUEST");
    }
    try {
      await routes(req, res, url);
    } catch (err) {
      if (res.headersSent) return res.destroy();
      if (err instanceof StoreError) return fail(res, err.status, err.code, err.extra);
      console.error("[intake] error:", err);
      return fail(res, 500, "INTERNAL_ERROR");
    }
  };

  const publicHandler = wrap(async (req, res, url) => {
    // Collector endpoints are served on the public port only when no separate collect port is configured
    if (url.pathname.startsWith("/collect/")) {
      if (config.collectPort != null) return fail(res, 404, "NOT_FOUND");
      return collectRoutes(req, res, url);
    }
    return publicRoutes(req, res, url);
  });
  const collectHandler = wrap(async (req, res, url) => {
    if (url.pathname.startsWith("/collect/")) return collectRoutes(req, res, url);
    if (url.pathname === "/healthz") return send(res, 200, "ok", { "Content-Type": "text/plain" });
    return fail(res, 404, "NOT_FOUND");
  });

  const sweep = async (now) => {
    const removed = await store.sweep({ now, incompleteTtlMs: config.incompleteTtlMs, readyTtlMs: config.readyTtlMs });
    uploadLimiter.prune();
    failLimiter.prune();
    if (removed) log(`swept ${removed} expired item(s)`);
    return removed;
  };

  return { store, publicHandler, collectHandler, sweep };
}

/** Start listeners. Returns handles plus the actual ports, which is useful with port 0 in tests. */
export async function startIntake(config) {
  const intake = createIntake(config);
  const listen = (handler, listenPort, host) =>
    new Promise((resolve, reject) => {
      const server = http.createServer(handler);
      server.requestTimeout = 0; // large chunks over slow links
      server.headersTimeout = 30_000;
      server.once("error", reject);
      server.listen(listenPort, host, () => resolve(server));
    });
  const publicServer = await listen(intake.publicHandler, config.port, config.host);
  const collectServer = config.collectPort != null ? await listen(intake.collectHandler, config.collectPort, config.collectHost) : null;
  await intake.sweep();
  const timer = setInterval(() => void intake.sweep().catch((e) => console.error("[intake] sweep failed:", e)), config.sweepIntervalMs);
  timer.unref();
  return {
    ...intake,
    publicPort: publicServer.address().port,
    collectPort: collectServer ? collectServer.address().port : null,
    close: async () => {
      clearInterval(timer);
      await Promise.all(
        [publicServer, collectServer].filter(Boolean).map(
          (s) =>
            new Promise((r) => {
              s.closeAllConnections?.();
              s.close(() => r());
            }),
        ),
      );
    },
  };
}
