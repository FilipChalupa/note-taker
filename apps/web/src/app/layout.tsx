import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WorkerStatus } from "@/components/WorkerStatus";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { I18nProvider } from "@/lib/i18n/client";
import { getMessages } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getMessages();
  return {
    title: locale === "cs" ? "Note Taker – přepisy schůzek" : "Note Taker – meeting transcripts",
    description:
      locale === "cs"
        ? "Přepis nahrávek schůzek s rozpoznáním mluvčích (WhisperX)"
        : "Meeting transcription with speaker diarization (WhisperX)",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, m } = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
            <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
              <nav className="flex items-center gap-4">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                  🎙️ {m.appName}
                </Link>
                <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  {m.nav.recordings}
                </Link>
                <Link href="/upload" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                  {m.nav.upload}
                </Link>
              </nav>
              <div className="flex items-center gap-3">
                <WorkerStatus />
                <LanguageSwitcher />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
