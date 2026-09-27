/**
 * Admin session for managing API tokens and reading the audit log.
 *
 * The rest of the browser UI stays open on the LAN, but minting a token hands out API access, so it needs
 * ADMIN_PASSWORD. Without the variable, token management is locked; tokens that already exist keep working.
 * The session is an HMAC-signed cookie bound to the current password, so changing the password logs everyone out.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/settings";

export const ADMIN_COOKIE = "nt_admin";
const SESSION_SECONDS = 12 * 3600;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function adminConfigured(): boolean {
  return Boolean(process.env.ADMIN_PASSWORD);
}

function secret(): string {
  let value = getSetting("admin_session_secret");
  if (!value) {
    value = randomBytes(32).toString("base64url");
    setSetting("admin_session_secret", value);
  }
  return value;
}

function sign(exp: number): string {
  // bound to the password: a new ADMIN_PASSWORD invalidates every existing session
  const passwordHash = sha256(process.env.ADMIN_PASSWORD ?? "").toString("hex");
  return createHmac("sha256", secret()).update(`${exp}:${passwordHash}`).digest("base64url");
}

export function checkPassword(candidate: unknown): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || typeof candidate !== "string") return false;
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function sessionCookieValue(): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  return `${exp}.${sign(exp)}`;
}

export function validSession(value: string | undefined | null): boolean {
  if (!adminConfigured() || !value) return false;
  const [expRaw, sig] = value.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now() || !sig) return false;
  const expected = Buffer.from(sign(exp));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function cookieFrom(req: Request): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === ADMIN_COOKIE) return v.join("=");
  }
  return null;
}

export function isAdminRequest(req: Request): boolean {
  return validSession(cookieFrom(req));
}

/** Guard for admin-only routes; returns a response to send when access is refused. */
export function requireAdmin(req: Request): NextResponse | null {
  if (!adminConfigured()) return NextResponse.json({ error: "ADMIN_NOT_CONFIGURED" }, { status: 403 });
  if (!isAdminRequest(req)) return NextResponse.json({ error: "ADMIN_REQUIRED" }, { status: 401 });
  return null;
}

export function sessionCookieOptions(req: Request) {
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  return { httpOnly: true, sameSite: "strict" as const, path: "/", secure: https, maxAge: SESSION_SECONDS };
}

// ---------------------------------------------------------------- brute force
const g = globalThis as unknown as { __noteTakerAdminFailures?: Map<string, number[]> };
const failures: Map<string, number[]> = (g.__noteTakerAdminFailures ??= new Map<string, number[]>());

export function clientKey(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
}

export function tooManyFailures(key: string): boolean {
  const recent = (failures.get(key) ?? []).filter((t) => Date.now() - t < FAILURE_WINDOW_MS);
  failures.set(key, recent);
  return recent.length >= MAX_FAILURES;
}

export function recordFailure(key: string): void {
  failures.set(key, [...(failures.get(key) ?? []), Date.now()]);
}

export function clearFailures(): void {
  failures.clear();
}
