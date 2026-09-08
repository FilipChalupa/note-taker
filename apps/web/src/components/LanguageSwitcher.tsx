"use client";

import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, LOCALES, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";

export function LanguageSwitcher() {
  const { locale } = useI18n();
  const router = useRouter();
  const set = (l: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-zinc-300 p-0.5 text-xs dark:border-zinc-700" aria-label="Language">
      {LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => set(l)}
          className={`rounded px-1.5 py-0.5 uppercase ${
            locale === l ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
