import { SettingsView } from "@/components/SettingsView";
import { getAppSettings } from "@/lib/settings";
import { getStorageInfo } from "@/lib/storage";
import { listVoices } from "@/lib/voices";
import { getLibraryStats } from "@/lib/recordings";
import { workerClient } from "@/lib/worker-client";
import { intakeStatus } from "@/lib/intake";
import { listApiTokens, listAudit } from "@/lib/auth";
import { cookies } from "next/headers";
import { ADMIN_COOKIE, adminConfigured, validSession } from "@/lib/admin";
import { getMessages } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { m } = await getMessages();
  const admin = { configured: adminConfigured(), unlocked: validSession((await cookies()).get(ADMIN_COOKIE)?.value) };
  const library = getLibraryStats();
  const worker = await workerClient.metrics().catch(() => null);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-2xl font-semibold">{m.settings.title}</h1>
      <SettingsView initial={getAppSettings()} storage={getStorageInfo()} voices={listVoices()} metrics={{ library, worker }} intake={intakeStatus()} admin={admin} tokens={admin.unlocked ? listApiTokens() : []} audit={admin.unlocked ? listAudit(15) : []} />
    </div>
  );
}
