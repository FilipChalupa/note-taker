import { notFound } from "next/navigation";
import { getRecording } from "@/lib/recordings";
import { ensurePollerStarted } from "@/lib/poller";
import { RecordingView } from "@/components/RecordingView";

export const dynamic = "force-dynamic";

export default async function RecordingPage({ params }: { params: Promise<{ id: string }> }) {
  ensurePollerStarted();
  const { id } = await params;
  const rec = getRecording(id);
  if (!rec) notFound();
  return <RecordingView initial={rec} />;
}
