import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, LOCALES, messages, negotiateLocale, type Locale, type Messages } from "./messages";

/** Locale for the current request: explicit cookie override, otherwise Accept-Language. */
export async function getLocale(): Promise<Locale> {
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (cookie && (LOCALES as string[]).includes(cookie)) return cookie as Locale;
  return negotiateLocale((await headers()).get("accept-language"));
}

export async function getMessages(): Promise<{ locale: Locale; m: Messages }> {
  const locale = await getLocale();
  return { locale, m: messages[locale] };
}
