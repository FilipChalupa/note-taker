import { UploadForm } from "@/components/UploadForm";
import { config } from "@/lib/config";
import { getMessages } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export default async function UploadPage() {
  const { m } = await getMessages();
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold">{m.upload.title}</h1>
      <UploadForm defaultLanguage={config.defaultLanguage} maxUploadBytes={config.maxUploadBytes} />
    </div>
  );
}
