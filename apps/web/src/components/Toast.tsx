"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type Kind = "error" | "success" | "info";
interface Toast {
  id: number;
  kind: Kind;
  text: string;
}
interface ToastApi {
  error: (text: string) => void;
  success: (text: string) => void;
  info: (text: string) => void;
}

const Ctx = createContext<ToastApi>({ error: () => {}, success: () => {}, info: () => {} });

/** Small stacked notifications in the corner; errors stay 6 s, the rest 3 s. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-4), { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3000);
  }, []);
  const api = useMemo<ToastApi>(() => ({ error: (t) => push("error", t), success: (t) => push("success", t), info: (t) => push("info", t) }), [push]);
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2 px-3 print:hidden" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-testid={`toast-${t.kind}`}
            className={`pointer-events-auto max-w-lg rounded-md px-4 py-2 text-sm shadow-lg ring-1 ring-inset ${
              t.kind === "error"
                ? "bg-red-50 text-red-800 ring-red-300 dark:bg-red-950 dark:text-red-200 dark:ring-red-800"
                : t.kind === "success"
                  ? "bg-emerald-50 text-emerald-800 ring-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:ring-emerald-800"
                  : "bg-zinc-50 text-zinc-800 ring-zinc-300 dark:bg-zinc-800 dark:text-zinc-100 dark:ring-zinc-700"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  return useContext(Ctx);
}
