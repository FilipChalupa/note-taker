import type { TrackInfo, TrackSpec } from "./index";

/**
 * Default speaker names from named tracks: a used track with exactly one speaker names that speaker
 * ("Filip" on the microphone track). Tracks with several people keep the plain "Speaker N" labels.
 */
export function trackSpeakerNames(tracks: TrackInfo[] | null | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  for (const t of tracks ?? []) {
    const name = t.name?.trim();
    if (t.used && name && t.speakers.length === 1) names[t.speakers[0]] = name;
  }
  return names;
}

/** The tracks of a finished run as a request for the next one (same streams, names and speaker counts). */
export function tracksToSpecs(tracks: TrackInfo[]): TrackSpec[] {
  return tracks.map((t) => ({
    index: t.index,
    name: t.name,
    use: t.used,
    min_speakers: t.min_speakers,
    max_speakers: t.max_speakers,
  }));
}

/** Check a tracks request from a client; returns the cleaned list or an error code. */
export function validateTrackSpecs(input: unknown): { tracks: TrackSpec[] } | { error: string } {
  if (!Array.isArray(input) || input.length === 0 || input.length > 32) return { error: "TRACKS_INVALID" };
  const seen = new Set<number>();
  const out: TrackSpec[] = [];
  const count = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  for (const raw of input) {
    if (!raw || typeof raw !== "object") return { error: "TRACKS_INVALID" };
    const r = raw as Record<string, unknown>;
    const index = Number(r.index);
    if (!Number.isInteger(index) || index < 0 || seen.has(index)) return { error: "TRACKS_INVALID" };
    seen.add(index);
    const min = count(r.min_speakers);
    const max = count(r.max_speakers);
    for (const v of [min, max]) if (v !== null && (!Number.isInteger(v) || v < 1 || v > 30)) return { error: "TRACKS_INVALID" };
    if (min !== null && max !== null && min > max) return { error: "SPEAKER_RANGE" };
    const name = typeof r.name === "string" ? r.name.trim().slice(0, 60) || null : null;
    out.push({ index, name, use: r.use !== false, min_speakers: min, max_speakers: max });
  }
  if (!out.some((t) => t.use)) return { error: "TRACKS_NONE_USED" };
  return { tracks: out.sort((a, b) => a.index - b.index) };
}
