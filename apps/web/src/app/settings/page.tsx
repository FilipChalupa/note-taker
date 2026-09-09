import { SettingsView } from "@/components/SettingsView";
import { getAppSettings } from "@/lib/settings";
import { getStorageInfo } from "@/lib/storage";
import { listVoices } from "@/lib/voices";
import { getMessages } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { m } = await getMessages();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold">{m.settings.title}</h1>
      <SettingsView initial={getAppSettings()} storage={getStorageInfo()} voices={listVoices()} />
    </div>
  );
}
