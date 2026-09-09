import { Recorder } from "@/components/Recorder";
import { getMessages } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function RecordPage() {
  const { m } = await getMessages();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-semibold">{m.record.title}</h1>
      <p className="mb-4 text-sm text-zinc-500">{m.record.intro}</p>
      <Recorder />
    </div>
  );
}
