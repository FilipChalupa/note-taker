"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const RATES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
export const SKIP_SEC = 5;
const RATE_KEY = "player.rate";

export interface Track {
  id: string;
  title: string;
  src: string;
  /** Known duration (seconds) before metadata loads. */
  duration?: number | null;
}

interface PlayerState {
  track: Track | null;
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
}

interface PlayerApi extends PlayerState {
  /** Load a track. Keeps playing state unless `autoplay` is given. Optionally start at `startAt`. */
  load: (track: Track, opts?: { autoplay?: boolean; startAt?: number }) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  skip: (delta: number) => void;
  setRate: (r: number) => void;
  stop: () => void;
}

const Ctx = createContext<PlayerApi | null>(null);

/**
 * Single persistent <audio> element mounted in the root layout so playback continues
 * while the user navigates between pages.
 */
export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [state, setState] = useState<PlayerState>({ track: null, playing: false, time: 0, duration: 0, rate: 1 });

  // Restore preferred rate
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(RATE_KEY));
      if (RATES.includes(saved as (typeof RATES)[number])) setState((s) => ({ ...s, rate: saved }));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const a = audioRef.current;
    if (a) a.playbackRate = state.rate;
  }, [state.rate, state.track?.src]);

  const load = useCallback<PlayerApi["load"]>((track, opts = {}) => {
    const a = audioRef.current;
    if (!a) return;
    setState((s) => {
      const same = s.track?.id === track.id;
      if (!same) {
        a.src = track.src;
        a.load();
        pendingSeek.current = opts.startAt ?? null;
      } else if (opts.startAt != null) {
        a.currentTime = opts.startAt;
      }
      if (opts.autoplay) void a.play().catch(() => {});
      return {
        ...s,
        track,
        time: same ? (opts.startAt ?? s.time) : (opts.startAt ?? 0),
        duration: same ? s.duration : (track.duration ?? 0),
        playing: opts.autoplay ? true : same ? s.playing : false,
      };
    });
  }, []);

  const play = useCallback(() => void audioRef.current?.play().catch(() => {}), []);
  const pause = useCallback(() => audioRef.current?.pause(), []);
  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  }, []);
  const seek = useCallback((t: number) => {
    const a = audioRef.current;
    if (!a || !a.src) return;
    const max = Number.isFinite(a.duration) ? a.duration : t;
    a.currentTime = Math.max(0, Math.min(t, max));
    setState((s) => ({ ...s, time: a.currentTime }));
  }, []);
  const skip = useCallback((delta: number) => {
    const a = audioRef.current;
    if (a && a.src) seek(a.currentTime + delta);
  }, [seek]);
  const setRate = useCallback((r: number) => {
    setState((s) => ({ ...s, rate: r }));
    try {
      localStorage.setItem(RATE_KEY, String(r));
    } catch {
      /* ignore */
    }
  }, []);
  const stop = useCallback(() => {
    const a = audioRef.current;
    if (a) {
      a.pause();
      a.removeAttribute("src");
      a.load();
    }
    setState((s) => ({ ...s, track: null, playing: false, time: 0, duration: 0 }));
  }, []);

  // Global keyboard shortcuts (ignored while typing in a field)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (!audioRef.current?.src) return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        skip(-SKIP_SEC);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        skip(SKIP_SEC);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, skip]);

  // OS media keys / lock screen controls
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    ms.metadata = state.track ? new MediaMetadata({ title: state.track.title, artist: "Note Taker" }) : null;
    ms.setActionHandler("play", play);
    ms.setActionHandler("pause", pause);
    ms.setActionHandler("seekbackward", () => skip(-SKIP_SEC));
    ms.setActionHandler("seekforward", () => skip(SKIP_SEC));
    ms.setActionHandler("seekto", (d) => d.seekTime != null && seek(d.seekTime));
  }, [state.track, play, pause, skip, seek]);

  const api = useMemo<PlayerApi>(
    () => ({ ...state, load, play, pause, toggle, seek, skip, setRate, stop }),
    [state, load, play, pause, toggle, seek, skip, setRate, stop],
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setState((s) => ({ ...s, playing: true }))}
        onPause={() => setState((s) => ({ ...s, playing: false }))}
        onEnded={() => setState((s) => ({ ...s, playing: false }))}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setState((s) => (Math.abs(s.time - t) < 0.05 ? s : { ...s, time: t }));
        }}
        onLoadedMetadata={(e) => {
          const a = e.currentTarget;
          a.playbackRate = state.rate;
          if (pendingSeek.current != null) {
            a.currentTime = pendingSeek.current;
            pendingSeek.current = null;
          }
          setState((s) => ({ ...s, duration: a.duration }));
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setState((s) => ({ ...s, duration: d }));
        }}
      />
    </Ctx.Provider>
  );
}

export function usePlayer(): PlayerApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}
