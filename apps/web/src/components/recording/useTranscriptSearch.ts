import { useMemo, useRef, useState } from "react";
import type { TranscriptSegment } from "@note-taker/shared";

/** In-transcript search (Ctrl+F): the matcher, match counts per segment and the current match. */
export function useTranscriptSearch(segments: TranscriptSegment[], initialQuery: string) {
  const [query, setQuery] = useState(initialQuery);
  const [matchCursor, setMatchCursor] = useState(0);
  const matchRef = useRef<HTMLSpanElement>(null);

  const matcher = useMemo(() => {
    const q = query.trim();
    if (!q) return null;
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Phrase match first (what Ctrl+F users expect); fall back to any-of-the-words when the phrase
    // never occurs, which is the case for hits coming from the full-text search page.
    const phrase = new RegExp(`(${q.split(/\s+/).map(esc).join("\\s+")})`, "giu");
    if (segments.some((sg) => phrase.test(sg.text))) return phrase;
    const terms = q.split(/\s+/).filter(Boolean).map(esc);
    return terms.length ? new RegExp(`(${terms.join("|")})`, "giu") : null;
  }, [query, segments]);

  /** Global index of the first match in each segment. */
  const { matchCount, matchOffsets } = useMemo(() => {
    const offsets = new Map<number, number>();
    if (!matcher) return { matchCount: 0, matchOffsets: offsets };
    let n = 0;
    segments.forEach((seg, i) => {
      offsets.set(i, n);
      n += seg.text.match(matcher)?.length ?? 0;
    });
    return { matchCount: n, matchOffsets: offsets };
  }, [matcher, segments]);

  const segmentOfMatch = (cursor: number): number => {
    let seg = -1;
    for (const [i, off] of matchOffsets) if (off <= cursor && i > seg) seg = i;
    return seg;
  };

  /** Move to the next (+1) or previous (-1) match, wrapping around. */
  const stepMatch = (dir: 1 | -1) => {
    if (matchCount > 0) setMatchCursor((c) => (c + (dir > 0 ? 1 : matchCount - 1)) % matchCount);
  };

  const changeQuery = (q: string) => {
    setQuery(q);
    setMatchCursor(0);
  };

  return { query, setQuery: changeQuery, matcher, matchCount, matchOffsets, matchCursor, stepMatch, matchRef, segmentOfMatch };
}
