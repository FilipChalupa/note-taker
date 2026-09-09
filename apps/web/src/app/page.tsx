import type { RecordingListQuery, RecordingSort, RecordingView } from "@note-taker/shared";
import { listTags, pageRecordings } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";
import { RecordingList } from "@/components/RecordingList";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  ensurePollerStarted();
  const sp = await searchParams;
  const query: RecordingListQuery = {
    tag: sp.tag?.trim() || undefined,
    view: (["active", "favorites", "archived", "all"].includes(sp.view ?? "") ? sp.view : "active") as RecordingView,
    sort: (["newest", "oldest", "title", "longest", "shortest"].includes(sp.sort ?? "") ? sp.sort : "newest") as RecordingSort,
    page: Number(sp.page) || 1,
  };
  return <RecordingList initial={pageRecordings(query)} tags={listTags()} query={query} />;
}
