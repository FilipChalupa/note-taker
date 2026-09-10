import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, LOCALES, TZ_COOKIE, messages, negotiateLocale, validTimeZone, type Locale, type Messages } from "./messages";

/** Locale for the current request: explicit cookie override, otherwise Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (cookie && (LOCALES as string[]).includes(cookie)) return cookie as Locale;
  return negotiateLocale((await headers()).get("accept-language"));
}

/** Browser time zone, remembered in a cookie by the client; falls back to the server's zone (TZ env). */
export async function getTimeZone(): Promise<string> {
  const cookie = (await cookies()).get(TZ_COOKIE)?.value;
  return validTimeZone(cookie) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
}

export async function getMessages(): Promise<{ locale: Locale; m: Messages; tz: string }> {
  const [locale, tz] = await Promise.all([getLocale(), getTimeZone()]);
  return { locale, m: messages[locale], tz };
}
