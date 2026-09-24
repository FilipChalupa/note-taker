/**
 * API tokens for /api/v1 (the MCP server and other agents). The browser UI keeps using /api/* and is not affected.
 *
 * Only the SHA-256 of a secret is stored, so a leaked database cannot be replayed against the API. Every
 * authenticated call is rate limited per token and written to the audit log.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { desc, eq, lt } from "drizzle-orm";
import type { ApiTokenCreated, ApiTokenInfo, ApiTokenScope, AuditEntry } from "@note-taker/shared";
import { config } from "@/lib/config";
import { db, schema } from "@/lib/db";

const { apiTokens, auditLog } = schema;
export const SCOPES: ApiTokenScope[] = ["submit", "read", "write", "admin"];
const now = () => new Date().toISOString();
const sha256 = (raw: string) => createHash("sha256").update(raw).digest("hex");

export interface AuthedToken {
  id: string;
  name: string;
  scopes: ApiTokenScope[];
  tagFilter: string | null;
}

function toInfo(row: typeof apiTokens.$inferSelect): ApiTokenInfo {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes ?? [],
    tagFilter: row.tagFilter ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt ?? null,
    lastUsedAt: row.lastUsedAt ?? null,
    revokedAt: row.revokedAt ?? null,
    requests: row.requests,
  };
}

export function listApiTokens(): ApiTokenInfo[] {
  return db.select().from(apiTokens).orderBy(desc(apiTokens.createdAt)).all().map(toInfo);
}

export function createApiToken(input: { name: string; scopes: ApiTokenScope[]; tagFilter?: string | null; expiresInDays?: number | null }): ApiTokenCreated {
  const scopes = [...new Set(input.scopes.filter((s) => SCOPES.includes(s)))];
  if (scopes.length === 0) throw new Error("INVALID_SCOPES");
  const secret = `nt_${randomBytes(32).toString("base64url")}`;
  const row = {
    id: randomUUID(),
    name: input.name.trim().slice(0, 80) || "token",
    tokenHash: sha256(secret),
    prefix: secret.slice(0, 11),
    scopes,
    tagFilter: input.tagFilter?.trim().slice(0, 40) || null,
    createdAt: now(),
    expiresAt: input.expiresInDays ? new Date(Date.now() + input.expiresInDays * 86400e3).toISOString() : null,
    lastUsedAt: null,
    revokedAt: null,
    requests: 0,
  };
  db.insert(apiTokens).values(row).run();
  return { token: toInfo(row as typeof apiTokens.$inferSelect), secret };
}

export function revokeApiToken(id: string): boolean {
  const row = db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.id, id)).get();
  if (!row) return false;
  db.update(apiTokens).set({ revokedAt: now() }).where(eq(apiTokens.id, id)).run();
  return true;
}

export function deleteApiToken(id: string): boolean {
  const row = db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.id, id)).get();
  if (!row) return false;
  db.delete(apiTokens).where(eq(apiTokens.id, id)).run();
  return true;
}

/** admin implies every other scope. */
export function hasScope(token: AuthedToken, scope: ApiTokenScope): boolean {
  return token.scopes.includes("admin") || token.scopes.includes(scope);
}

// ------------------------------------------------------------- rate limiting
type Window = { hits: number[]; submits: number[] };
const g = globalThis as unknown as { __noteTakerApiLimits?: Map<string, Window> };
const limits: Map<string, Window> = (g.__noteTakerApiLimits ??= new Map<string, Window>());

function take(tokenId: string, kind: "hits" | "submits", limit: number): boolean {
  const w = limits.get(tokenId) ?? { hits: [], submits: [] };
  const cutoff = Date.now() - 3600e3;
  w[kind] = w[kind].filter((t) => t > cutoff);
  limits.set(tokenId, w);
  if (w[kind].length >= limit) return false;
  w[kind].push(Date.now());
  return true;
}

// ----------------------------------------------------------------- auditing
export function audit(entry: { token: AuthedToken | null; action: string; recordingId?: string | null; status: number; detail?: string }): void {
  db.insert(auditLog)
    .values({
      at: now(),
      tokenId: entry.token?.id ?? null,
      tokenName: entry.token?.name ?? null,
      action: entry.action.slice(0, 120),
      recordingId: entry.recordingId ?? null,
      status: entry.status,
      detail: entry.detail?.slice(0, 500) ?? null,
    })
    .run();
}

export function listAudit(limit = 50): AuditEntry[] {
  return db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      tokenName: auditLog.tokenName,
      action: auditLog.action,
      recordingId: auditLog.recordingId,
      status: auditLog.status,
      detail: auditLog.detail,
    })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(Math.min(500, limit))
    .all();
}

export function pruneAudit(): void {
  const cutoff = new Date(Date.now() - config.auditRetentionDays * 86400e3).toISOString();
  db.delete(auditLog).where(lt(auditLog.at, cutoff)).run();
}

// ----------------------------------------------------------- authentication
function bearer(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const url = new URL(req.url);
  return url.searchParams.get("token");
}

function constantTimeFind(secret: string): (typeof apiTokens.$inferSelect) | null {
  const wanted = Buffer.from(sha256(secret), "hex");
  let found: (typeof apiTokens.$inferSelect) | null = null;
  for (const row of db.select().from(apiTokens).all()) {
    const candidate = Buffer.from(row.tokenHash, "hex");
    if (candidate.length === wanted.length && timingSafeEqual(candidate, wanted)) found = row;
  }
  return found;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

export function apiFail(code: string, status: number, extra: Record<string, unknown> = {}): NextResponse {
  return NextResponse.json({ error: { code, ...extra } }, { status });
}

/**
 * Authenticate and authorize a request. Throws ApiError, which the route wrapper turns into a response.
 * `scope` may be "any" (every valid token passes; the route filters what it returns) or a list, where one match
 * is enough. Reading is intentionally permissive: a submit-only token is narrowed to its own recordings instead.
 */
export function requireToken(req: Request, scope: ApiTokenScope | "any" | ApiTokenScope[], opts: { submit?: boolean } = {}): AuthedToken {
  const secret = bearer(req);
  if (!secret) throw new ApiError("UNAUTHORIZED", 401);
  const row = constantTimeFind(secret);
  if (!row) throw new ApiError("UNAUTHORIZED", 401);
  if (row.revokedAt) throw new ApiError("TOKEN_REVOKED", 401);
  if (row.expiresAt && Date.parse(row.expiresAt) < Date.now()) throw new ApiError("TOKEN_EXPIRED", 401);

  const token: AuthedToken = { id: row.id, name: row.name, scopes: row.scopes ?? [], tagFilter: row.tagFilter ?? null };
  const wanted = scope === "any" ? [] : Array.isArray(scope) ? scope : [scope];
  if (wanted.length > 0 && !wanted.some((s) => hasScope(token, s))) throw new ApiError("FORBIDDEN_SCOPE", 403);
  if (!take(token.id, "hits", config.apiRequestsPerHour)) throw new ApiError("RATE_LIMITED", 429);
  if (opts.submit && !take(token.id, "submits", config.apiSubmitsPerHour)) throw new ApiError("SUBMIT_LIMIT", 429);

  db.update(apiTokens)
    .set({ lastUsedAt: now(), requests: row.requests + 1 })
    .where(eq(apiTokens.id, row.id))
    .run();
  return token;
}

/** Wrap a route handler: maps ApiError to a JSON response and writes the audit entry. */
export function withApi<T extends unknown[]>(
  action: string,
  handler: (req: Request, ...args: T) => Promise<{ response: NextResponse; token?: AuthedToken | null; recordingId?: string | null }>,
): (req: Request, ...args: T) => Promise<NextResponse> {
  return async (req: Request, ...args: T) => {
    try {
      const { response, token = null, recordingId = null } = await handler(req, ...args);
      audit({ token, action, recordingId, status: response.status });
      return response;
    } catch (err) {
      if (err instanceof ApiError) {
        audit({ token: null, action, status: err.status, detail: err.code });
        return apiFail(err.code, err.status);
      }
      console.error(`[api] ${action} failed:`, err);
      audit({ token: null, action, status: 500, detail: (err as Error).message });
      return apiFail("INTERNAL_ERROR", 500);
    }
  };
}
