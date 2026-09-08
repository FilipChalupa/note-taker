import { QueueView } from "@/components/QueueView";
import { getMessages } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const { m } = await getMessages();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold">{m.queue.title}</h1>
      <QueueView />
    </div>
  );
}
