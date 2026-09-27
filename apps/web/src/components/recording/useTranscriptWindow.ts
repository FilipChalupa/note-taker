import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SpeakerTurn } from "@/lib/format";

const VIRTUAL_MIN_TURNS = 60;
const EST_TURN_PX = 110;
const GAP_PX = 16;
const OVERSCAN_PX = 800;

type Target = "active" | "match";

/**
 * Windowed rendering of speaker turns for long recordings: only turns near the viewport are
 * mounted, spacers keep the scroll height. Printing renders everything.
 */
export function useTranscriptWindow(
  turns: SpeakerTurn[],
  refs: Record<Target, React.RefObject<HTMLSpanElement | null>>,
) {
  const [forceAll, setForceAll] = useState(false);
  const virtual = turns.length > VIRTUAL_MIN_TURNS && !forceAll;
  const listRef = useRef<HTMLDivElement>(null);
  const heights = useRef<number[]>([]);
  const [range, setRange] = useState<[number, number]>([0, 40]);
  const pendingScroll = useRef<Target | null>(null);

  const turnOfSegment = useMemo(() => {
    const a: number[] = [];
    turns.forEach((t, ti) => t.segments.forEach((sg) => (a[sg.index] = ti)));
    return a;
  }, [turns]);

  const heightOf = (i: number) => (heights.current[i] ?? EST_TURN_PX) + GAP_PX;
  const offsetOf = (i: number) => {
    let y = 0;
    for (let k = 0; k < i && k < turns.length; k++) y += heightOf(k);
    return y;
  };

  const recompute = useCallback(() => {
    if (!virtual || !listRef.current) return;
    const top = listRef.current.getBoundingClientRect().top + window.scrollY;
    const vs = window.scrollY - top - OVERSCAN_PX;
    const ve = window.scrollY + window.innerHeight - top + OVERSCAN_PX;
    let y = 0;
    let start = 0;
    while (start < turns.length && y + heightOf(start) < vs) y += heightOf(start++);
    let end = start;
    while (end < turns.length && y < ve) y += heightOf(end++);
    setRange((prev) => (prev[0] === start && prev[1] === end ? prev : [start, end]));
  }, [virtual, turns.length]);

  useEffect(() => {
    if (!virtual) return;
    recompute();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(recompute);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [virtual, recompute]);

  useEffect(() => {
    const before = () => setForceAll(true);
    const after = () => setForceAll(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);

  useEffect(() => {
    // finish a scroll requested while the target turn was not rendered yet
    const what = pendingScroll.current;
    if (!what) return;
    const el = refs[what].current;
    if (el) {
      pendingScroll.current = null;
      el.scrollIntoView({ block: "center" });
    }
  });

  const measure = (ti: number) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const h = el.offsetHeight;
    if (Math.abs((heights.current[ti] ?? 0) - h) > 1) heights.current[ti] = h;
  };

  /** Scroll the active segment or current match into view, mounting its turn first if needed. */
  const reveal = (segmentIndex: number, what: Target) => {
    const ti = segmentIndex >= 0 ? turnOfSegment[segmentIndex] : undefined;
    if (virtual && ti != null && (ti < range[0] || ti >= range[1]) && listRef.current) {
      pendingScroll.current = what;
      const top = listRef.current.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top + offsetOf(ti) - 160) });
      recompute();
      return;
    }
    refs[what].current?.scrollIntoView(what === "active" ? { block: "center", behavior: "smooth" } : { block: "center" });
  };

  const [start, end] = virtual ? range : [0, turns.length];
  return {
    virtual,
    listRef,
    measure,
    reveal,
    /** First mounted turn index and the turns to render. */
    start,
    visible: turns.slice(start, end),
    topSpacer: virtual ? offsetOf(start) : 0,
    bottomSpacer: virtual ? Math.max(0, offsetOf(turns.length) - offsetOf(end)) : 0,
  };
}

/** Live offsetHeight of an element (0 until mounted). */
export function useElementHeight(ref: React.RefObject<HTMLElement | null>, dep: unknown) {
  const [h, setH] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, dep]);
  return h;
}
