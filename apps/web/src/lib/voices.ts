/**
 * Known voices: learn a speaker embedding when the user names a speaker, and suggest names for
 * speakers of new recordings by cosine similarity. Server-side only.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Voice, VoiceSuggestion } from "@note-taker/shared";
import { db, schema } from "@/lib/db";

const { voices } = schema;
const MAX_SAMPLES = 12;
/** Below this similarity we do not suggest at all; above STRONG the UI marks it as a confident match. */
export const SUGGEST_THRESHOLD = 0.45;
export const STRONG_THRESHOLD = 0.7;

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na) / Math.sqrt(nb) : -1;
}

function mean(vectors: number[][]): number[] {
  const out = new Array<number>(vectors[0].length).fill(0);
  for (const v of vectors) for (let i = 0; i < out.length; i++) out[i] += v[i];
  return out.map((x) => x / vectors.length);
}

const now = () => new Date().toISOString();

export function listVoices(): Voice[] {
  return db
    .select()
    .from(voices)
    .all()
    .map((v) => ({ id: v.id, name: v.name, samples: v.samples.length, createdAt: v.createdAt, updatedAt: v.updatedAt }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findVoiceByName(name: string) {
  const key = name.trim().toLowerCase();
  return db.select().from(voices).all().find((v) => v.name.trim().toLowerCase() === key) ?? null;
}

/**
 * Attach a sample to the voice called `name` (created if needed). One sample per recording+speaker;
 * re-saving the same speaker replaces its sample instead of adding a duplicate.
 */
export function learnVoice(name: string, vector: number[], recordingId: string, speaker: string): Voice {
  const clean = name.trim().slice(0, 80);
  const existing = findVoiceByName(clean);
  const sample = { recordingId, speaker, vector };
  if (existing) {
    const samples = [...existing.samples.filter((s) => !(s.recordingId === recordingId && s.speaker === speaker)), sample].slice(-MAX_SAMPLES);
    db.update(voices)
      .set({ samples, embedding: mean(samples.map((s) => s.vector)), updatedAt: now() })
      .where(eq(voices.id, existing.id))
      .run();
    return { id: existing.id, name: existing.name, samples: samples.length, createdAt: existing.createdAt, updatedAt: now() };
  }
  const id = randomUUID();
  db.insert(voices).values({ id, name: clean, embedding: vector, samples: [sample], createdAt: now(), updatedAt: now() }).run();
  return { id, name: clean, samples: 1, createdAt: now(), updatedAt: now() };
}

/** Remove the sample a recording contributed (e.g. speaker renamed to someone else). */
export function forgetSample(recordingId: string, speaker: string): void {
  for (const v of db.select().from(voices).all()) {
    if (!v.samples.some((s) => s.recordingId === recordingId && s.speaker === speaker)) continue;
    const samples = v.samples.filter((s) => !(s.recordingId === recordingId && s.speaker === speaker));
    if (samples.length === 0) db.delete(voices).where(eq(voices.id, v.id)).run();
    else db.update(voices).set({ samples, embedding: mean(samples.map((s) => s.vector)), updatedAt: now() }).where(eq(voices.id, v.id)).run();
  }
}

export function renameVoice(id: string, name: string): Voice | null {
  const v = db.select().from(voices).where(eq(voices.id, id)).get();
  if (!v) return null;
  db.update(voices).set({ name: name.trim().slice(0, 80), updatedAt: now() }).where(eq(voices.id, id)).run();
  return { id, name: name.trim(), samples: v.samples.length, createdAt: v.createdAt, updatedAt: now() };
}

export function deleteVoice(id: string): boolean {
  const v = db.select({ id: voices.id }).from(voices).where(eq(voices.id, id)).get();
  if (!v) return false;
  db.delete(voices).where(eq(voices.id, id)).run();
  return true;
}

/** Best known voice per speaker; a voice is suggested for at most one speaker (highest score wins). */
export function suggestSpeakers(embeddings: Record<string, number[]> | null | undefined): Record<string, VoiceSuggestion> {
  if (!embeddings) return {};
  const known = db.select().from(voices).all();
  if (known.length === 0) return {};
  const candidates: Array<{ speaker: string; voice: (typeof known)[number]; score: number }> = [];
  for (const [speaker, vec] of Object.entries(embeddings)) {
    for (const voice of known) {
      // compare with the mean and with the best single sample; take the better one
      let score = cosine(vec, voice.embedding);
      for (const s of voice.samples) score = Math.max(score, cosine(vec, s.vector));
      if (score >= SUGGEST_THRESHOLD) candidates.push({ speaker, voice, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const out: Record<string, VoiceSuggestion> = {};
  const usedVoices = new Set<string>();
  for (const c of candidates) {
    if (out[c.speaker] || usedVoices.has(c.voice.id)) continue;
    out[c.speaker] = { voiceId: c.voice.id, name: c.voice.name, score: Math.round(c.score * 1000) / 1000 };
    usedVoices.add(c.voice.id);
  }
  return out;
}
