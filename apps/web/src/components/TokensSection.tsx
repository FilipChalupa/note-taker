"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiTokenCreated, ApiTokenInfo, ApiTokenScope, AuditEntry } from "@note-taker/shared";
import { Dialog } from "./Dialog";
import { useToast } from "./Toast";
import { api } from "@/lib/api-client";
import { formatDate } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const SCOPES: ApiTokenScope[] = ["submit", "read", "write", "admin"];

function AdminGate({ configured }: { configured: boolean }) {
  const { m } = useI18n();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!configured) return <p className="text-sm text-amber-700 dark:text-amber-300">{m.tokens.notConfigured}</p>;
  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.status === 204) {
        setPassword("");
        router.refresh();
      } else setError(res.status === 429 ? m.tokens.tooManyAttempts : m.tokens.wrongPassword);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={unlock} className="flex flex-wrap items-center gap-2" data-testid="admin-unlock">
      <input className="input w-60" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={m.tokens.password} aria-label={m.tokens.password} />
      <button className="btn btn-primary py-1.5 text-sm" type="submit" disabled={busy || !password}>
        🔒 {m.tokens.unlock}
      </button>
      <span className="w-full text-xs text-zinc-500">{m.tokens.lockedHelp}</span>
      {error && <span className="w-full text-sm text-red-600" role="alert">{error}</span>}
    </form>
  );
}

export function TokensSection({ initial, audit, admin }: { initial: ApiTokenInfo[]; audit: AuditEntry[]; admin: { configured: boolean; unlocked: boolean } }) {
  if (!admin.unlocked) {
    return (
      <LockedTokens configured={admin.configured} />
    );
  }
  return <UnlockedTokens initial={initial} audit={audit} />;
}

function LockedTokens({ configured }: { configured: boolean }) {
  const { m } = useI18n();
  return (
    <section className="card p-5" data-testid="tokens">
      <h2 className="font-semibold">{m.tokens.title}</h2>
      <p className="mb-3 mt-1 text-sm text-zinc-500">{m.tokens.help}</p>
      <AdminGate configured={configured} />
    </section>
  );
}

function UnlockedTokens({ initial, audit }: { initial: ApiTokenInfo[]; audit: AuditEntry[] }) {
  const { locale, m, tz } = useI18n();
  const router = useRouter();
  const lock = async () => {
    await fetch("/api/admin/session", { method: "DELETE" });
    router.refresh();
  };
  const toast = useToast();
  const [tokens, setTokens] = useState(initial);
  const [dialog, setDialog] = useState<null | "create" | { revoke: ApiTokenInfo }>(null);
  const [secret, setSecret] = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied] = useState(false);
  interface TokenForm {
    name: string;
    scopes: ApiTokenScope[];
    tagFilter: string;
    expiresInDays: string;
  }
  const emptyForm: TokenForm = { name: "", scopes: ["submit"], tagFilter: "", expiresInDays: "" };
  const [form, setForm] = useState<TokenForm>(emptyForm);
  const fail = (err: unknown) => toast.error(fmt(m.toast.failed, { detail: (err as Error).message }));

  const reload = async () => setTokens(await api<ApiTokenInfo[]>(m, "/api/tokens"));

  const create = async () => {
    try {
      const created = await api<ApiTokenCreated>(m, "/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: form.name, scopes: form.scopes, tagFilter: form.tagFilter || null, expiresInDays: Number(form.expiresInDays) || null }),
      });
      setDialog(null);
      setSecret(created);
      setForm(emptyForm);
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const revoke = async (t: ApiTokenInfo) => {
    setDialog(null);
    try {
      await api(m, `/api/tokens/${t.id}`, { method: "POST" });
      toast.success(m.tokens.revoked);
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const remove = async (t: ApiTokenInfo) => {
    try {
      await api(m, `/api/tokens/${t.id}`, { method: "DELETE" });
      await reload();
    } catch (err) {
      fail(err);
    }
  };

  const scopeLabel: Record<ApiTokenScope, string> = {
    submit: m.tokens.scopeSubmit,
    read: m.tokens.scopeRead,
    write: m.tokens.scopeWrite,
    admin: m.tokens.scopeAdmin,
  };

  return (
    <section className="card p-5" data-testid="tokens">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{m.tokens.title}</h2>
        <button className="btn px-2 py-1 text-xs" onClick={lock} data-testid="admin-lock">
          🔓 {m.tokens.lock}
        </button>
      </div>
      <p className="mb-3 mt-1 text-sm text-zinc-500">{m.tokens.help}</p>

      {tokens.length === 0 ? (
        <p className="text-sm text-zinc-500">{m.tokens.none}</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800" data-testid="token-list">
          {tokens.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
              <span className="font-medium">{t.name}</span>
              <code className="text-xs text-zinc-500">{t.prefix}…</code>
              <span className="flex gap-1">
                {t.scopes.map((s) => (
                  <span key={s} className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {s}
                  </span>
                ))}
                {t.tagFilter && <span className="rounded bg-blue-100 px-1.5 text-[11px] text-blue-800 dark:bg-blue-900 dark:text-blue-200">#{t.tagFilter}</span>}
              </span>
              <span className="text-xs text-zinc-500">
                {fmt(m.tokens.created, { when: formatDate(t.createdAt, locale, tz) })} ·{" "}
                {t.lastUsedAt ? fmt(m.tokens.lastUsed, { when: formatDate(t.lastUsedAt, locale, tz) }) : m.tokens.neverUsed} · {fmt(m.tokens.requests, { n: t.requests })}
              </span>
              {t.revokedAt && <span className="text-xs font-medium text-red-600">{m.tokens.revoked}</span>}
              <span className="ml-auto flex gap-1">
                {!t.revokedAt && (
                  <button className="btn px-2 py-1 text-xs" onClick={() => setDialog({ revoke: t })}>
                    {m.tokens.revoke}
                  </button>
                )}
                <button className="btn btn-danger px-2 py-1 text-xs" onClick={() => remove(t)}>
                  {m.tokens.delete}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <button className="btn btn-primary mt-3 py-1 text-xs" onClick={() => setDialog("create")}>
        + {m.tokens.create}
      </button>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-zinc-500">{m.tokens.audit}</summary>
        {audit.length === 0 ? (
          <p className="mt-2 text-xs text-zinc-500">{m.tokens.auditEmpty}</p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-zinc-500">
            {audit.map((a) => (
              <li key={a.id}>
                {formatDate(a.at, locale, tz)} · {a.tokenName ?? "-"} · {a.action} · {a.status}
                {a.recordingId ? ` · ${a.recordingId.slice(0, 8)}` : ""}
              </li>
            ))}
          </ul>
        )}
      </details>

      <Dialog
        open={dialog === "create"}
        title={m.tokens.create}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-primary" onClick={create} disabled={!form.name.trim() || form.scopes.length === 0}>
              {m.tokens.create}
            </button>
          </>
        }
      >
        <label className="block">
          <span className="text-xs text-zinc-500">{m.tokens.name}</span>
          <input className="input" value={form.name} placeholder={m.tokens.namePlaceholder} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <fieldset>
          <legend className="text-xs text-zinc-500">{m.tokens.scopes}</legend>
          {SCOPES.map((s) => (
            <label key={s} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={form.scopes.includes(s)}
                onChange={(e) => setForm({ ...form, scopes: e.target.checked ? [...form.scopes, s] : form.scopes.filter((x) => x !== s) })}
              />
              {scopeLabel[s]}
            </label>
          ))}
        </fieldset>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="text-xs text-zinc-500">{m.tokens.tagFilter}</span>
            <input className="input" value={form.tagFilter} onChange={(e) => setForm({ ...form, tagFilter: e.target.value })} />
          </label>
          <label className="w-28">
            <span className="text-xs text-zinc-500">{m.tokens.expires}</span>
            <input className="input" type="number" min={1} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value })} />
          </label>
        </div>
      </Dialog>

      <Dialog
        open={typeof dialog === "object" && dialog !== null && "revoke" in dialog}
        title={m.tokens.revoke}
        onClose={() => setDialog(null)}
        actions={
          <>
            <button className="btn" onClick={() => setDialog(null)}>
              {m.detail.cancel}
            </button>
            <button className="btn btn-danger" onClick={() => typeof dialog === "object" && dialog && "revoke" in dialog && revoke(dialog.revoke)}>
              {m.detail.confirm}
            </button>
          </>
        }
      >
        <p>{typeof dialog === "object" && dialog && "revoke" in dialog ? fmt(m.tokens.confirmRevoke, { name: dialog.revoke.name }) : ""}</p>
      </Dialog>

      <Dialog
        open={secret !== null}
        title={m.tokens.secretTitle}
        onClose={() => setSecret(null)}
        actions={
          <button className="btn btn-primary" onClick={() => setSecret(null)}>
            {m.tokens.close}
          </button>
        }
      >
        <p className="text-zinc-600 dark:text-zinc-300">{m.tokens.secretHelp}</p>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-800" data-testid="token-secret">
            {secret?.secret}
          </code>
          <button
            className="btn py-1 text-xs"
            onClick={async () => {
              if (!secret) return;
              await navigator.clipboard.writeText(secret.secret).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? m.tokens.copied : m.tokens.copy}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{m.tokens.mcpHint}</p>
        <pre className="overflow-x-auto rounded bg-zinc-100 p-2 text-[11px] dark:bg-zinc-800">{`claude mcp add note-taker -- npx -y @note-taker/mcp
# NOTE_TAKER_URL=http://<this-host>:3000
# NOTE_TAKER_TOKEN=${secret?.secret ?? ""}`}</pre>
      </Dialog>
    </section>
  );
}
