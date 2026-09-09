"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/client";

type State = "unsupported" | "insecure" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Bell button: subscribe this browser to "recording finished" push notifications. */
export function NotificationsToggle({ full = false }: { full?: boolean }) {
  const { m } = useI18n();
  const [state, setState] = useState<State>("busy");

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
    if (!window.isSecureContext) return setState("insecure");
    if (Notification.permission === "denied") return setState("denied");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    setState(sub ? "on" : "off");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = async () => {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setState(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const { publicKey } = (await (await fetch("/api/push/vapid")).json()) as { publicKey: string };
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      setState("on");
    } catch (err) {
      console.error("push subscribe failed", err);
      setState("off");
    }
  };

  const disable = async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
    } finally {
      setState("off");
    }
  };

  const label =
    state === "on" ? m.push.on : state === "denied" ? m.push.denied : state === "insecure" ? m.push.insecure : state === "unsupported" ? m.push.unsupported : m.push.off;
  const disabled = state === "busy" || state === "unsupported" || state === "insecure" || state === "denied";
  const onClick = () => (state === "on" ? disable() : enable());

  if (full) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button className={`btn ${state === "on" ? "" : "btn-primary"}`} onClick={onClick} disabled={disabled}>
          {state === "on" ? "🔔 " + m.push.disable : "🔔 " + m.push.enable}
        </button>
        <span className="text-sm text-zinc-500">{label}</span>
      </div>
    );
  }
  if (state === "unsupported") return null;
  return (
    <button
      className={`rounded px-1.5 py-0.5 text-sm ${state === "on" ? "text-blue-600 dark:text-blue-300" : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {state === "on" ? "🔔" : "🔕"}
    </button>
  );
}
