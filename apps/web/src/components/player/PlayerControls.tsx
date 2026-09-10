"use client";

import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { RATES, SKIP_SEC } from "./PlayerProvider";

interface Props {
  playing: boolean;
  time: number;
  duration: number;
  rate: number;
  onToggle: () => void;
  onSkip: (delta: number) => void;
  onSeek: (t: number) => void;
  onRate: (r: number) => void;
  compact?: boolean;
}

/** Transport controls shared by the full player (recording page) and the global mini bar. */
export function PlayerControls({ playing, time, duration, rate, onToggle, onSkip, onSeek, onRate, compact }: Props) {
  const { m } = useI18n();
  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : ""}>
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn" onClick={() => onSkip(-SKIP_SEC)} title={m.detail.back5} aria-label={m.detail.back5}>
          ⏪ 5 s
        </button>
        <button className={`btn btn-primary justify-center whitespace-nowrap ${compact ? "w-20" : "w-24"}`} onClick={onToggle} title={m.detail.playPauseHint}>
          {playing ? m.detail.pause : m.detail.play}
        </button>
        <button className="btn" onClick={() => onSkip(SKIP_SEC)} title={m.detail.fwd5} aria-label={m.detail.fwd5}>
          5 s ⏩
        </button>
        {compact && (
          <select
            className="rounded-md border border-zinc-300 bg-white px-1 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-900 sm:hidden"
            value={rate}
            onChange={(e) => onRate(Number(e.target.value))}
            aria-label={m.detail.speed}
          >
            {RATES.map((r) => (
              <option key={r} value={r}>
                {r}×
              </option>
            ))}
          </select>
        )}
        <div className={`ml-1 items-center gap-0.5 rounded-md border border-zinc-300 p-0.5 dark:border-zinc-700 ${compact ? "hidden sm:flex" : "flex"}`} title={m.detail.speed}>
          {RATES.map((r) => (
            <button
              key={r}
              onClick={() => onRate(r)}
              className={`rounded px-1.5 py-1 text-xs font-medium ${
                rate === r ? "bg-blue-600 text-white" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              }`}
            >
              {r}×
            </button>
          ))}
        </div>
        {!compact && (
          <span className="ml-auto whitespace-nowrap font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        )}
      </div>
      <div className={compact ? "flex min-w-0 flex-1 basis-full items-center gap-2 sm:basis-[220px]" : "mt-3"}>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => onSeek(Number(e.target.value))}
          className="w-full accent-blue-600"
          aria-label={`${formatTime(time)} / ${formatTime(duration)}`}
        />
        {compact && (
          <span className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
            {formatTime(time)} / {formatTime(duration)}
          </span>
        )}
      </div>
    </div>
  );
}
