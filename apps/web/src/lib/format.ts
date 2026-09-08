import type { TranscriptSegment } from "@note-taker/shared";

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

export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "–";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min`;
  return `${s} s`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
}

/** Default label for a raw speaker id: SPEAKER_00 -> "Mluvčí 1" (by order of first appearance). */
export function defaultSpeakerLabel(speakerId: string, speakers: string[]): string {
  if (speakerId === "UNKNOWN") return "Neznámý";
  const idx = speakers.indexOf(speakerId);
  if (idx >= 0) return `Mluvčí ${idx + 1}`;
  const m = /SPEAKER_(\d+)/.exec(speakerId);
  return m ? `Mluvčí ${Number(m[1]) + 1}` : speakerId;
}

export function speakerLabel(speakerId: string, speakers: string[], names: Record<string, string>): string {
  const custom = names[speakerId]?.trim();
  return custom || defaultSpeakerLabel(speakerId, speakers);
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
    const m = /SPEAKER_(\d+)/.exec(speakerId);
    idx = m ? Number(m[1]) : 0;
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

export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: "cs", label: "Čeština" },
  { code: "sk", label: "Slovenština" },
  { code: "en", label: "Angličtina" },
  { code: "de", label: "Němčina" },
  { code: "pl", label: "Polština" },
  { code: "fr", label: "Francouzština" },
  { code: "es", label: "Španělština" },
  { code: "it", label: "Italština" },
  { code: "uk", label: "Ukrajinština" },
  { code: "ru", label: "Ruština" },
  { code: "auto", label: "Automaticky rozpoznat" },
];

export const STATUS_LABEL: Record<string, string> = {
  QUEUED: "Ve frontě",
  PROCESSING: "Zpracovává se",
  COMPLETED: "Hotovo",
  FAILED: "Chyba",
};

export const PHASE_LABEL: Record<string, string> = {
  QUEUED: "Ve frontě",
  CONVERTING: "Konverze audia",
  TRANSCRIBING: "Přepis",
  DIARIZING: "Rozpoznávání mluvčích",
  COMPLETED: "Hotovo",
  FAILED: "Chyba",
};
