"use client";

import { useEffect, useState } from "react";
import { Dialog } from "../Dialog";
import { useI18n } from "@/lib/i18n/client";

export interface ConfirmRequest {
  title: string;
  text: string;
  danger?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const { m } = useI18n();
  return (
    <Dialog
      open={request !== null}
      title={request?.title ?? ""}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {m.detail.cancel}
          </button>
          <button
            className={`btn ${request?.danger ? "btn-danger" : "btn-primary"}`}
            onClick={() => {
              onClose();
              request?.onConfirm();
            }}
          >
            {m.detail.confirm}
          </button>
        </>
      }
    >
      <p>{request?.text ?? ""}</p>
    </Dialog>
  );
}

export interface RediarizeOptions {
  minSpeakers?: number;
  maxSpeakers?: number;
}

/** Asks how many speakers to look for before recomputing diarization. */
export function RediarizeDialog({
  open,
  speakerCount,
  onClose,
  onSubmit,
}: {
  open: boolean;
  speakerCount: number | null;
  onClose: () => void;
  onSubmit: (options: RediarizeOptions) => void;
}) {
  const { m } = useI18n();
  const [mode, setMode] = useState<"auto" | "exact" | "range">("auto");
  const [count, setCount] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  useEffect(() => {
    if (!open) return;
    setCount(speakerCount && speakerCount > 1 ? String(speakerCount) : "");
    setMode("auto");
  }, [open, speakerCount]);

  const submit = () => {
    const int = (v: string) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
    onSubmit(
      mode === "exact"
        ? { minSpeakers: int(count), maxSpeakers: int(count) }
        : mode === "range"
          ? { minSpeakers: int(min), maxSpeakers: int(max) }
          : {},
    );
  };

  return (
    <Dialog
      open={open}
      title={m.detail.rediarizeTitle}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            {m.detail.cancel}
          </button>
          <button className="btn btn-primary" onClick={submit}>
            {m.detail.start}
          </button>
        </>
      }
    >
      <p className="text-zinc-600 dark:text-zinc-300">{m.detail.rediarizeText}</p>
      <label className="flex items-center gap-2">
        <input type="radio" name="rmode" checked={mode === "auto"} onChange={() => setMode("auto")} /> {m.detail.rediarizeAuto}
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="rmode" checked={mode === "exact"} onChange={() => setMode("exact")} /> {m.detail.rediarizeExact}
        <input className="input w-20 py-1" type="number" min={1} max={30} value={count} onFocus={() => setMode("exact")} onChange={(e) => setCount(e.target.value)} />
      </label>
      <label className="flex items-center gap-2">
        <input type="radio" name="rmode" checked={mode === "range"} onChange={() => setMode("range")} /> {m.detail.rediarizeRange}
        <input className="input w-20 py-1" type="number" min={1} max={30} value={min} onFocus={() => setMode("range")} onChange={(e) => setMin(e.target.value)} />
        –
        <input className="input w-20 py-1" type="number" min={1} max={30} value={max} onFocus={() => setMode("range")} onChange={(e) => setMax(e.target.value)} />
      </label>
    </Dialog>
  );
}

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { m } = useI18n();
  return (
    <Dialog open={open} title={m.detail.shortcuts} onClose={onClose}>
      <ul className="space-y-1">
        {Object.values(m.detail.shortcutList).map((line) => (
          <li key={line} className="text-zinc-700 dark:text-zinc-300">
            {line}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
