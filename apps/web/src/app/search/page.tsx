import Link from "next/link";
import { searchRecordings } from "@/lib/recordings";
import { getMessages } from "@/lib/i18n/server";
import { fmt } from "@/lib/i18n";
import { formatDate, formatDuration } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q = "" } = await searchParams;
  const { locale, m } = await getMessages();
  const query = q.trim();
  const hits = query ? searchRecordings(query) : [];
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold">{m.search.title}</h1>
      <p className="mb-4 text-sm text-zinc-500">
        {query && <>„{query}“ · {fmt(m.search.hits, { n: hits.length })}</>}
      </p>
      {query && hits.length === 0 && <div className="card p-10 text-center text-zinc-500">{m.search.none}</div>}
      <div className="space-y-3">
        {hits.map((h) => (
          <Link key={h.id} href={`/recordings/${h.id}?q=${encodeURIComponent(query)}`} className="card block p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
            <div className="flex items-baseline justify-between gap-3">
              <div className="font-medium">{h.title}</div>
              <div className="shrink-0 text-xs text-zinc-500">
                {formatDate(h.createdAt, locale)} · {formatDuration(h.durationSec, m)}
              </div>
            </div>
            {/* snippet is HTML-escaped server-side; only <mark> tags are injected */}
            <p className="mt-1 text-sm text-zinc-600 [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5 dark:text-zinc-300 dark:[&_mark]:bg-yellow-700/60" dangerouslySetInnerHTML={{ __html: h.snippet }} />
          </Link>
        ))}
      </div>
    </div>
  );
}
