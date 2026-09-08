"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { QueueItem, QueueResponse } from "@note-taker/shared";
import { formatDate, formatDuration, phaseLabel } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

const POLL_MS = 2000;

export function QueueView() {
  const { locale, m } = useI18n();
  const [data, setData] = useState<QueueResponse | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch("/api/worker/queue", { cache: "no-store" });
        if (r.ok && alive) setData((await r.json()) as QueueResponse);
      } catch {
        /* keep last state */
      }
    };
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (!data) return <p className="text-sm text-zinc-500">…</p>;

  const isEmpty = !data.current && data.pending.length === 0 && data.waiting.length === 0;

  const Item = ({ item, index }: { item: QueueItem; index?: number }) => {
    const title = item.recording?.title ?? item.filename ?? item.taskId ?? "–";
    const inner = (
      <div className="flex items-center gap-3 px-4 py-3">
        {index != null && <span className="w-8 shrink-0 font-mono text-sm text-zinc-400">{fmt(m.queue.position, { n: index })}</span>}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{title}</div>
          <div className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
            {item.recording && item.filename && item.filename !== title && <span className="truncate">{item.filename}</span>}
            {!item.recording && <span className="italic">{m.queue.external}</span>}
            <span>
              {m.queue.added} {formatDate(item.createdAt, locale)}
            </span>
            {item.startedAt && (
              <span>
                {m.queue.started} {formatDate(item.startedAt, locale)}
              </span>
            )}
            {item.durationSec != null && (
              <span>
                {m.queue.length} {formatDuration(item.durationSec, m)}
              </span>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-zinc-500">
          <div>{phaseLabel(item.phase, m)}</div>
          {item.etaSeconds != null && (
            <div className="mt-0.5 text-zinc-600 dark:text-zinc-300">
              {fmt(m.queue.remaining, { d: formatDuration(Math.max(item.etaSeconds, 1), m) })}
              {item.expectedFinishAt && (
                <>
                  {" · "}
                  {fmt(m.queue.finishAt, { t: new Date(item.expectedFinishAt).toLocaleTimeString(locale === "cs" ? "cs-CZ" : "en-GB", { hour: "2-digit", minute: "2-digit" }) })}
                </>
              )}
            </div>
          )}
          {item.speedRtf != null && item.queuePosition === 0 && <div className="mt-0.5">{fmt(m.queue.speed, { x: item.speedRtf })}</div>}
          {item.queuePosition === 0 && (
            <div className="mt-1 h-1.5 w-32 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
              <div className="h-full bg-blue-500 transition-all duration-500" style={{ width: `${item.progress}%` }} />
            </div>
          )}
        </div>
      </div>
    );
    return item.recording ? (
      <Link href={`/recordings/${item.recording.id}`} className="block hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
        {inner}
      </Link>
    ) : (
      inner
    );
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section className="card overflow-hidden">
      <h2 className="border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/60">
        {title}
      </h2>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</div>
    </section>
  );

  return (
    <div className="space-y-4">
      {!data.reachable && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300" title={data.error}>
          {m.queue.offline}
        </div>
      )}
      {isEmpty && <div className="card p-10 text-center text-zinc-500">{m.queue.empty}</div>}
      {data.current && (
        <Section title={m.queue.current}>
          <Item item={data.current} />
        </Section>
      )}
      {data.pending.length > 0 && (
        <Section title={m.queue.pending}>
          {data.pending.map((it, i) => (
            <Item key={it.taskId ?? i} item={it} index={i + 1} />
          ))}
        </Section>
      )}
      {data.waiting.length > 0 && (
        <Section title={m.queue.waiting}>
          {data.waiting.map((it) => (
            <Item key={it.recording?.id} item={it} />
          ))}
        </Section>
      )}
      <p className="text-xs text-zinc-500">{m.queue.autoRefresh}</p>
    </div>
  );
}
