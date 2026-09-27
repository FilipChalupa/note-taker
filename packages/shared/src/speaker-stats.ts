/**
 * Speaking time, share, turns and words per speaker.
 *
 * One implementation for the detail page, the agent API and the Markdown export, so their numbers cannot drift
 * apart. A turn is a maximal run of consecutive segments by the same speaker. Numbers are not rounded; callers
 * round for their own display.
 */

export interface StatsSegment {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface SpeakerStat {
  speaker: string;
  /** seconds of speech */
  seconds: number;
  /** 0..1 share of all speech */
  share: number;
  turns: number;
  words: number;
}

export interface SpeakerStats {
  /** In the given speaker order; speakers missing from it follow in order of first appearance. */
  rows: SpeakerStat[];
  totalSeconds: number;
  /** Number of times the speaker changed. */
  speakerChanges: number;
  longestTurnSeconds: number;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export function computeSpeakerStats(segments: StatsSegment[], speakerOrder: string[] = []): SpeakerStats {
  const per = new Map<string, { seconds: number; turns: number; words: number }>();
  let turnCount = 0;
  let longest = 0;
  let current: string | null = null;
  let currentSeconds = 0;

  for (const seg of segments) {
    const seconds = Math.max(0, seg.end - seg.start);
    const row = per.get(seg.speaker) ?? { seconds: 0, turns: 0, words: 0 };
    row.seconds += seconds;
    row.words += wordCount(seg.text);
    if (seg.speaker !== current) {
      row.turns += 1;
      turnCount += 1;
      current = seg.speaker;
      currentSeconds = 0;
    }
    currentSeconds += seconds;
    longest = Math.max(longest, currentSeconds);
    per.set(seg.speaker, row);
  }

  const totalSeconds = [...per.values()].reduce((a, r) => a + r.seconds, 0);
  const order = [...speakerOrder.filter((s) => per.has(s)), ...[...per.keys()].filter((s) => !speakerOrder.includes(s))];
  return {
    rows: order.map((speaker) => {
      const r = per.get(speaker)!;
      return { speaker, seconds: r.seconds, share: totalSeconds > 0 ? r.seconds / totalSeconds : 0, turns: r.turns, words: r.words };
    }),
    totalSeconds,
    speakerChanges: Math.max(0, turnCount - 1),
    longestTurnSeconds: longest,
  };
}
