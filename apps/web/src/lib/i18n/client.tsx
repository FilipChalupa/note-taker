"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { TZ_COOKIE, messages, type Locale, type Messages } from "./messages";

const Ctx = createContext<{ locale: Locale; m: Messages; tz: string }>({ locale: "en", m: messages.en, tz: "UTC" });

/**
 * `tz` starts as the server's guess (cookie or TZ env) so SSR and hydration agree; after mount the
 * browser's real zone wins and is remembered in a cookie for the next server render.
 */
export function I18nProvider({ locale, tz: initialTz, children }: { locale: Locale; tz: string; children: React.ReactNode }) {
  const [tz, setTz] = useState(initialTz);
  useEffect(() => {
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserTz) return;
    if (browserTz !== initialTz) setTz(browserTz);
    if (!document.cookie.split("; ").includes(`${TZ_COOKIE}=${browserTz}`)) {
      document.cookie = `${TZ_COOKIE}=${browserTz}; path=/; max-age=31536000; samesite=lax`;
    }
  }, [initialTz]);
  return <Ctx.Provider value={{ locale, m: messages[locale], tz }}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
