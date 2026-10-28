import { validateTrackSpecs, type TrackSpec } from "@note-taker/shared";

/** The optional `tracks` form field of an upload: a JSON array of TrackSpec. Empty = automatic. */
export function parseTracksField(value: FormDataEntryValue | null): { tracks?: TrackSpec[] } | { error: string } {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "TRACKS_INVALID" };
  }
  return validateTrackSpecs(parsed);
}
