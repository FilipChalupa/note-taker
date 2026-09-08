import type { TranscriptSegment } from "@note-taker/shared";
import { fmt, type Locale, type Messages } from "@/lib/i18n";

/** 3725.4 -> "1:02:05" ; 65 -> "1:05" */
export function formatTime(sec: number | null | undefined, forceHours = false): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 || forceHours ? String(m).padStart(2, "0") : String(m);
  return h > 0 || forceHours ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
}

export function formatDuration(sec: number | null | undefined, m: Messages): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} ${m.units.h} ${min} ${m.units.min}`;
  if (min > 0) return `${min} ${m.units.min}`;
  return `${s} ${m.units.s}`;
}

export function intlLocale(locale: Locale): string {
  return locale === "cs" ? "cs-CZ" : "en-GB";
}

export function formatDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleString(intlLocale(locale), { dateStyle: "medium", timeStyle: "short" });
}

/** Default label for a raw speaker id: SPEAKER_00 -> "Speaker 1" (by order of first appearance). */
export function defaultSpeakerLabel(speakerId: string, speakers: string[], m: Messages): string {
  if (speakerId === "UNKNOWN") return m.speaker.unknown;
  const idx = speakers.indexOf(speakerId);
  if (idx >= 0) return fmt(m.speaker.default, { n: idx + 1 });
  const match = /SPEAKER_(\d+)/.exec(speakerId);
  return match ? fmt(m.speaker.default, { n: Number(match[1]) + 1 }) : speakerId;
}

export function speakerLabel(speakerId: string, speakers: string[], names: Record<string, string>, m: Messages): string {
  const custom = names[speakerId]?.trim();
  return custom || defaultSpeakerLabel(speakerId, speakers, m);
}

/**
 * Phases are stored language-neutrally as "KEY" or "KEY:param" (e.g. "WORKER_QUEUE:3").
 * Unknown values (raw worker text) are returned as-is.
 */
export function phaseLabel(phase: string | null | undefined, m: Messages): string | null {
  if (!phase) return null;
  const [key, param] = phase.split(":", 2);
  const template = (m.phase as Record<string, string>)[key];
  return template ? fmt(template, { n: param ?? "" }) : phase;
}

/** Warnings are stored as "CODE:detail"; the code is translated, the detail appended. */
export function warningLabel(warning: string | null | undefined, m: Messages): string | null {
  if (!warning) return null;
  const idx = warning.indexOf(":");
  const key = idx >= 0 ? warning.slice(0, idx) : warning;
  const detail = idx >= 0 ? warning.slice(idx + 1) : "";
  const template = (m.warnings as Record<string, string>)[key];
  return template ? fmt(template, { detail }) : warning;
}

/** Our own error codes are translated; raw worker messages pass through. */
export function errorLabel(error: string | null | undefined, m: Messages): string | null {
  if (!error) return null;
  const [key, param] = error.split(":", 2);
  const template = (m.errors as Record<string, string>)[key];
  return template ? fmt(template, { mb: param ?? "", status: param ?? "", msg: param ?? "" }) : error;
}

const PALETTE = [
  { h: 217, s: 78, l: 52 }, // blue
  { h: 152, s: 55, l: 40 }, // green
  { h: 28, s: 85, l: 52 }, // orange
  { h: 286, s: 55, l: 52 }, // purple
  { h: 350, s: 72, l: 52 }, // red/pink
  { h: 190, s: 70, l: 40 }, // teal
  { h: 48, s: 85, l: 45 }, // yellow
  { h: 330, s: 60, l: 50 }, // magenta
];

export function speakerColor(speakerId: string, speakers: string[]): { fg: string; bg: string; border: string } {
  if (speakerId === "UNKNOWN") return { fg: "hsl(0 0% 45%)", bg: "hsl(0 0% 45% / 0.08)", border: "hsl(0 0% 45% / 0.4)" };
  let idx = speakers.indexOf(speakerId);
  if (idx < 0) {
    const match = /SPEAKER_(\d+)/.exec(speakerId);
    idx = match ? Number(match[1]) : 0;
  }
  const c = PALETTE[idx % PALETTE.length];
  return {
    fg: `hsl(${c.h} ${c.s}% ${c.l}%)`,
    bg: `hsl(${c.h} ${c.s}% ${c.l}% / 0.09)`,
    border: `hsl(${c.h} ${c.s}% ${c.l}% / 0.45)`,
  };
}

export interface SpeakerTurn {
  speaker: string;
  start: number;
  end: number;
  segments: Array<TranscriptSegment & { index: number }>;
}

/** Merge consecutive segments of the same speaker into "turns" for display/export. */
export function groupTurns(segments: TranscriptSegment[]): SpeakerTurn[] {
  const turns: SpeakerTurn[] = [];
  segments.forEach((seg, index) => {
    const last = turns[turns.length - 1];
    if (last && last.speaker === seg.speaker) {
      last.segments.push({ ...seg, index });
      last.end = seg.end;
    } else {
      turns.push({ speaker: seg.speaker, start: seg.start, end: seg.end, segments: [{ ...seg, index }] });
    }
  });
  return turns;
}

/** Transcription languages offered in the upload form (labels come from messages.languages). */
export const LANGUAGE_CODES = ["cs", "sk", "en", "de", "pl", "fr", "es", "it", "uk", "ru", "auto"] as const;
