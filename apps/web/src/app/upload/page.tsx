import { UploadForm } from "@/components/UploadForm";
import { config } from "@/lib/config";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-semibold">Nahrát novou schůzku</h1>
      <UploadForm defaultLanguage={config.defaultLanguage} maxUploadBytes={config.maxUploadBytes} />
    </div>
  );
}
