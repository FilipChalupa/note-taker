/**
 * Web Push notifications (VAPID). Keys are generated on first use and kept in the settings table,
 * so no configuration is required. Server-side only.
 */
import webpush, { type PushSubscription } from "web-push";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { fmt, messages, type Locale } from "@/lib/i18n";

const { pushSubscriptions } = schema;

function vapid(): { publicKey: string; privateKey: string; subject: string } {
  let publicKey = getSetting("vapid_public");
  let privateKey = getSetting("vapid_private");
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting("vapid_public", publicKey);
    setSetting("vapid_private", privateKey);
  }
  return { publicKey, privateKey, subject: process.env.PUSH_CONTACT || "mailto:admin@note-taker.local" };
}

export function getVapidPublicKey(): string {
  return vapid().publicKey;
}

export function addSubscription(sub: PushSubscription, locale: Locale): void {
  db.insert(pushSubscriptions)
    .values({ endpoint: sub.endpoint, subscription: sub as never, locale, createdAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { subscription: sub as never, locale } })
    .run();
}

export function removeSubscription(endpoint: string): void {
  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).run();
}

export function subscriptionCount(): number {
  return db.select({ endpoint: pushSubscriptions.endpoint }).from(pushSubscriptions).all().length;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/** Send a notification to every subscriber; drops subscriptions the push service reports as gone. */
export async function notifyAll(build: (locale: Locale) => PushPayload): Promise<void> {
  const subs = db.select().from(pushSubscriptions).all();
  if (subs.length === 0) return;
  const { publicKey, privateKey, subject } = vapid();
  webpush.setVapidDetails(subject, publicKey, privateKey);
  await Promise.all(
    subs.map(async (s) => {
      const locale = (s.locale === "cs" ? "cs" : "en") as Locale;
      try {
        await webpush.sendNotification(s.subscription as PushSubscription, JSON.stringify(build(locale)), { TTL: 60 * 60 * 24 });
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) removeSubscription(s.endpoint);
        else console.warn("[push] send failed:", (err as Error).message);
      }
    }),
  );
}

/** Notification for a finished (or failed) recording. */
export function recordingNotification(rec: { id: string; title: string; status: "COMPLETED" | "FAILED"; speakerCount?: number | null }) {
  return (locale: Locale): PushPayload => {
    const m = messages[locale].push;
    return {
      title: rec.status === "COMPLETED" ? m.doneTitle : m.failedTitle,
      body: rec.status === "COMPLETED" ? fmt(m.doneBody, { title: rec.title, n: rec.speakerCount ?? 0 }) : fmt(m.failedBody, { title: rec.title }),
      url: `/recordings/${rec.id}`,
      tag: `recording-${rec.id}`,
    };
  };
}
