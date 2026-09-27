import { cs } from "./cs";
import { en } from "./en";

export type Locale = "cs" | "en";
export const LOCALES: Locale[] = ["cs", "en"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "locale";
export const TZ_COOKIE = "tz";

/** IANA time zone if valid, otherwise null. */
export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Replace `{name}` placeholders. */
export function fmt(template: string, params: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
}

export type Messages = typeof cs;

export const messages: Record<Locale, Messages> = { cs, en };

/** Parse an Accept-Language header and pick the best supported locale. */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return DEFAULT_LOCALE;
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())).find(Boolean);
      return { tag: tag.toLowerCase(), q: q ? Number(q[1]) : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (base === "cs" || base === "sk") return "cs";
    if (base === "en") return "en";
  }
  return DEFAULT_LOCALE;
}
