"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/client";
import { PlayerControls } from "./PlayerControls";
import { usePlayer } from "./PlayerProvider";

/** Sticky mini player shown on every page except the detail page of the track being played. */
export function GlobalPlayerBar() {
  const p = usePlayer();
  const { m } = useI18n();
  const pathname = usePathname();
  if (!p.track) return null;
  if (pathname === `/recordings/${p.track.id}`) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-2">
        <div className="min-w-0 flex-1 basis-48">
          <div className="text-[11px] uppercase tracking-wide text-zinc-500">{m.player.nowPlaying}</div>
          <Link href={`/recordings/${p.track.id}`} className="block truncate text-sm font-medium hover:underline">
            {p.track.title}
          </Link>
        </div>
        <div className="flex-[3] basis-[420px]">
          <PlayerControls
            compact
            playing={p.playing}
            time={p.time}
            duration={p.duration}
            rate={p.rate}
            onToggle={p.toggle}
            onSkip={p.skip}
            onSeek={p.seek}
            onRate={p.setRate}
          />
        </div>
        <button className="btn" onClick={p.stop} title={m.player.close} aria-label={m.player.close}>
          ✕
        </button>
      </div>
    </div>
  );
}
