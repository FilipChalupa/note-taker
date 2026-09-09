import { eq } from "drizzle-orm";
import type { AppSettings } from "@note-taker/shared";
import { db, schema } from "@/lib/db";

const { settings } = schema;

export function getSetting(key: string): string | null {
  return db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)).get()?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date().toISOString() } })
    .run();
}

export function getAppSettings(): AppSettings {
  return { glossary: getSetting("glossary") ?? "" };
}

/** Normalize a glossary (lines or commas) into a comma-separated list of unique terms. */
export function normalizeTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const t = raw.trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/**
 * Build Whisper's initial prompt from the global glossary and per-recording hints.
 * Whisper reads at most ~224 tokens of prompt, so the list is trimmed.
 */
export function buildInitialPrompt(hints: string | null | undefined, maxChars = 900): string | undefined {
  const terms = normalizeTerms([getSetting("glossary") ?? "", hints ?? ""].join("\n"));
  if (terms.length === 0) return undefined;
  let prompt = terms.join(", ");
  if (prompt.length > maxChars) prompt = prompt.slice(0, maxChars).replace(/,[^,]*$/, "");
  return prompt + ".";
}
