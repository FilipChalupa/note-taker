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

export const SUPPORTED_MEDIA = /\.(mp3|mpga|m4a|m4b|wav|aac|ogg|oga|opus|flac|wma|aiff?|mka|webm|mp4|m4v|mov|mkv|avi|mpe?g|ts|3gp|amr)$/i;
export const LANGUAGES = ["cs", "sk", "en", "de", "pl", "fr", "es", "it", "uk", "ru", "auto"];
