import { listRecordings, listTags } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";
import { RecordingList } from "@/components/RecordingList";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  ensurePollerStarted();
  const { tag } = await searchParams;
  const activeTag = tag?.trim() || null;
  return <RecordingList initial={listRecordings(activeTag ? { tag: activeTag } : undefined)} tags={listTags()} activeTag={activeTag} />;
}
