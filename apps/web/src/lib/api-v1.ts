/** Shared shapes for /api/v1 so the MCP server and the web speak the same language. */
import type { RecordingDetail, RecordingSummary, TranscriptSegment } from "@note-taker/shared";
import { audioQualityIssues, computeSpeakerStats } from "@note-taker/shared";
import type { AuthedToken } from "@/lib/auth";
import { hasScope } from "@/lib/auth";
import { speakerLabel } from "@/lib/format";
import { messages } from "@/lib/i18n";

/** Recording as agents see it: no file paths, speaker ids already resolved to names. */
export function publicRecording(rec: RecordingSummary | RecordingDetail) {
  const detail = "segments" in rec ? (rec as RecordingDetail) : null;
  return {
    id: rec.id,
    title: rec.title,
    status: rec.status,
    progress: rec.progress,
    phase: rec.phase,
    language: rec.language,
    durationSeconds: rec.durationSec,
    speakerCount: rec.speakerCount,
    tags: rec.tags,
    favorite: rec.favorite,
    archived: rec.archived,
    error: rec.error,
    warning: rec.warning,
    audioIssues: rec.audioIssues,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    ...(detail
      ? {
          notes: detail.notes,
          hints: detail.hints,
          speakers: detail.speakers.map((id) => ({ id, name: speakerLabel(id, detail.speakers, detail.speakerNames, messages.en), named: Boolean(detail.speakerNames[id]) })),
          segmentCount: detail.segments.length,
          audioQuality: detail.audioQuality
            ? {
                speechDb: detail.audioQuality.speech_db,
                noiseDb: detail.audioQuality.noise_db,
                snrDb: detail.audioQuality.snr_db,
                clippedShare: detail.audioQuality.clipped_share,
                issues: audioQualityIssues(detail.audioQuality),
              }
            : null,
        }
      : {}),
  };
}

export function publicSegments(rec: RecordingDetail, withWords: boolean) {
  return rec.segments.map((s: TranscriptSegment, index: number) => ({
    index,
    start: s.start,
    end: s.end,
    speaker: s.speaker,
    speakerName: speakerLabel(s.speaker, rec.speakers, rec.speakerNames, messages.en),
    text: s.text,
    ...(withWords && s.words ? { words: s.words.map((w) => ({ word: w.word, start: w.start ?? null, end: w.end ?? null })) } : {}),
  }));
}

/** Speaking time and turns per speaker, rounded for the API. */
export function speakerStats(rec: RecordingDetail) {
  return computeSpeakerStats(rec.segments, rec.speakers).rows.map((r) => ({
    speaker: r.speaker,
    name: speakerLabel(r.speaker, rec.speakers, rec.speakerNames, messages.en),
    seconds: Math.round(r.seconds * 10) / 10,
    share: Math.round(r.share * 1000) / 1000,
    turns: r.turns,
    words: r.words,
  }));
}

/** A submit-only token may see just what it created; a tag filter narrows a read token further. */
export function canAccess(rec: { ownerTokenId?: string | null; tags: string[] }, token: AuthedToken): boolean {
  if (!hasScope(token, "read")) return rec.ownerTokenId === token.id;
  if (token.tagFilter) return rec.tags.some((t) => t.toLowerCase() === token.tagFilter!.toLowerCase());
  return true;
}
