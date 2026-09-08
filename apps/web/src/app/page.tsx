import { listRecordings } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";
import { RecordingList } from "@/components/RecordingList";

export const dynamic = "force-dynamic";

export default function HomePage() {
  ensurePollerStarted();
  const initial = listRecordings();
  return <RecordingList initial={initial} />;
}
