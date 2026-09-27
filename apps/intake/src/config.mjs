import fs from "node:fs";
import path from "node:path";

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};
const bool = (v) => /^(1|true|yes|on)$/i.test(String(v ?? ""));
const port = (v, d) => (v === "0" ? 0 : num(v, d));

/** All configuration comes from environment variables. Nothing here points to the internal system. */
export function loadConfig(env = process.env) {
  return {
    host: env.HOST || "0.0.0.0",
    port: port(env.PORT, 8080),
    // Optional separate listener for the collector API, e.g. bound to a VPN interface only
    collectPort: env.COLLECT_PORT ? port(env.COLLECT_PORT, null) : null,
    collectHost: env.COLLECT_HOST || env.HOST || "0.0.0.0",
    dataDir: path.resolve(env.DATA_DIR || "./data"),
    uploadCode: env.INTAKE_UPLOAD_CODE || null,
    collectToken: env.INTAKE_COLLECT_TOKEN || null,
    maxUploadBytes: num(env.MAX_UPLOAD_MB, 4096) * 1024 * 1024,
    maxPendingBytes: num(env.MAX_PENDING_GB, 20) * 1024 ** 3,
    chunkBytes: num(env.CHUNK_MB, 8) * 1024 * 1024,
    incompleteTtlMs: num(env.UPLOAD_TTL_HOURS, 24) * 3600e3,
    readyTtlMs: num(env.READY_TTL_DAYS, 14) * 86400e3,
    rateLimitPerHour: num(env.RATE_LIMIT_PER_HOUR, 30),
    trustProxy: bool(env.TRUST_PROXY),
    title: (env.INTAKE_TITLE || "Note Taker").slice(0, 60),
    defaultLanguage: /^[a-z]{2}$|^auto$/.test(env.DEFAULT_LANGUAGE || "") ? env.DEFAULT_LANGUAGE : "cs",
    sweepIntervalMs: num(env.SWEEP_INTERVAL_SECONDS, 600) * 1000,
    quiet: bool(env.QUIET),
  };
}

/** Copy of packages/shared/media-extensions.json (kept here so the intake deploys on its own; a test checks they match). */
export const MEDIA_EXTENSIONS = JSON.parse(fs.readFileSync(new URL("./media-extensions.json", import.meta.url), "utf8"));
export const SUPPORTED_MEDIA = new RegExp(`\\.(${MEDIA_EXTENSIONS.join("|")})$`, "i");
export const MEDIA_ACCEPT = [...MEDIA_EXTENSIONS.map((e) => `.${e}`), "audio/*", "video/*"].join(",");
export const LANGUAGES = ["cs", "sk", "en", "de", "pl", "fr", "es", "it", "uk", "ru", "auto"];
