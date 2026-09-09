import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { WorkerStatus } from "@/components/WorkerStatus";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { I18nProvider } from "@/lib/i18n/client";
import { PlayerProvider } from "@/components/player/PlayerProvider";
import { GlobalPlayerBar } from "@/components/player/GlobalPlayerBar";
import { DropProvider } from "@/components/DropProvider";
import { SearchBox } from "@/components/SearchBox";
import { NotificationsToggle } from "@/components/NotificationsToggle";
import { getMessages } from "@/lib/i18n/server";

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#2563eb" },
    { media: "(prefers-color-scheme: dark)", color: "#18181b" },
  ],
  width: "device-width",
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  const { locale } = await getMessages();
  return {
    title: locale === "cs" ? "Note Taker – přepisy schůzek" : "Note Taker – meeting transcripts",
    description:
      locale === "cs"
        ? "Přepis nahrávek schůzek s rozpoznáním mluvčích (WhisperX)"
        : "Meeting transcription with speaker diarization (WhisperX)",
    applicationName: "Note Taker",
    manifest: "/manifest.webmanifest",
    appleWebApp: { capable: true, title: "Note Taker", statusBarStyle: "default" },
    formatDetection: { telephone: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, m } = await getMessages();
  return (
    <html lang={locale}>
      <body>
        <I18nProvider locale={locale}>
          <PlayerProvider>
          <DropProvider>
          <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
            <div className="mx-auto max-w-6xl px-3 py-2 sm:px-4">
              <div className="flex items-center justify-between gap-2">
                <Link href="/" className="whitespace-nowrap text-base font-semibold tracking-tight sm:text-lg">
                  🎙️ {m.appName}
                </Link>
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <WorkerStatus />
                  <NotificationsToggle />
                  <LanguageSwitcher />
                </div>
              </div>
              <div className="mt-1.5 flex items-center gap-3">
                <nav className="flex shrink-0 items-center gap-3 overflow-x-auto whitespace-nowrap text-sm sm:gap-4">
                  <Link href="/" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                    {m.nav.recordings}
                  </Link>
                  <Link href="/upload" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                    {m.nav.upload}
                  </Link>
                  <Link href="/record" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                    {m.nav.record}
                  </Link>
                  <Link href="/settings" className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                    {m.nav.settings}
                  </Link>
                </nav>
                <SearchBox />
              </div>
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-3 py-4 pb-40 sm:px-4 sm:py-6 sm:pb-28">{children}</main>
          <GlobalPlayerBar />
          </DropProvider>
          </PlayerProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
