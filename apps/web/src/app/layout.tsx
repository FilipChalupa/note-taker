import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { WorkerStatus } from "@/components/WorkerStatus";

export const metadata: Metadata = {
  title: "Note Taker – přepisy schůzek",
  description: "Přepis nahrávek schůzek s rozpoznáním mluvčích (WhisperX)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs">
      <body>
        <header className="border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/80">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
            <nav className="flex items-center gap-4">
              <Link href="/" className="text-lg font-semibold tracking-tight">
                🎙️ Note Taker
              </Link>
              <Link href="/" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                Nahrávky
              </Link>
              <Link href="/upload" className="text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                Nahrát
              </Link>
            </nav>
            <WorkerStatus />
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
