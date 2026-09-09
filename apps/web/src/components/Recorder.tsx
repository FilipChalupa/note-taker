"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingDetail } from "@note-taker/shared";
import { formatTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import { requestWorkerRefresh } from "./WorkerStatus";

type Phase = "idle" | "recording" | "paused" | "uploading";

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) ?? "";
}

/** In-browser recorder: MediaRecorder -> Blob -> POST /api/recordings. */
export function Recorder() {
  const { m } = useI18n();
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);

  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const pausedTotal = useRef(0);
  const pausedAt = useRef(0);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") setSupported(false);
  }, []);

  // Enumerate mics (labels appear after the first permission grant)
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === "audioinput"));
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  // Timer + level meter
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => {
      setElapsed((Date.now() - startedAt.current - pausedTotal.current) / 1000);
      const a = analyser.current;
      if (a) {
        const buf = new Uint8Array(a.fftSize);
        a.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += (v - 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) / 40));
      }
    }, 200);
    return () => clearInterval(t);
  }, [phase]);

  // Warn before leaving while recording
  useEffect(() => {
    if (phase !== "recording" && phase !== "paused") return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = m.record.leaveWarning;
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [phase, m.record.leaveWarning]);

  const cleanup = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    analyser.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const start = async () => {
    setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      stream.current = s;
      void refreshDevices();
      try {
        const ctx = new AudioContext();
        const src = ctx.createMediaStreamSource(s);
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        src.connect(an);
        audioCtx.current = ctx;
        analyser.current = an;
      } catch {
        /* meter is optional */
      }
      const mime = pickMime();
      const rec = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 96_000 } : undefined);
      chunks.current = [];
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      rec.start(1000); // 1 s chunks so a crash loses at most a second
      recorder.current = rec;
      startedAt.current = Date.now();
      pausedTotal.current = 0;
      setElapsed(0);
      setPhase("recording");
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* optional */
      }
    } catch (err) {
      setError((err as Error).name === "NotAllowedError" ? m.record.micDenied : (err as Error).message);
      cleanup();
    }
  };

  const pause = () => {
    recorder.current?.pause();
    pausedAt.current = Date.now();
    setPhase("paused");
  };
  const resume = () => {
    recorder.current?.resume();
    pausedTotal.current += Date.now() - pausedAt.current;
    setPhase("recording");
  };

  const finish = (): Promise<Blob> =>
    new Promise((resolve) => {
      const rec = recorder.current;
      if (!rec) return resolve(new Blob());
      const type = rec.mimeType || "audio/webm";
      rec.onstop = () => resolve(new Blob(chunks.current, { type }));
      rec.stop();
    });

  const stopAndUpload = async () => {
    setPhase("uploading");
    const blob = await finish();
    cleanup();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
    const filename = `recording_${stamp}.${ext}`;
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("title", title.trim() || `${m.record.title} ${stamp}`);
    setProgress(0);
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/recordings");
      xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const rec = JSON.parse(xhr.responseText) as RecordingDetail;
          requestWorkerRefresh();
          router.push(`/recordings/${rec.id}`);
        } else {
          setError(`HTTP ${xhr.status}`);
          setPhase("idle");
        }
        resolve();
      };
      xhr.onerror = () => {
        setError(m.errors.NETWORK);
        setPhase("idle");
        resolve();
      };
      xhr.send(form);
    });
  };

  const discard = async () => {
    if (recorder.current && recorder.current.state !== "inactive") await finish();
    cleanup();
    chunks.current = [];
    setPhase("idle");
    setElapsed(0);
    setLevel(0);
  };

  if (!supported) return <div className="card p-6 text-red-600">{m.record.unsupported}</div>;

  const active = phase === "recording" || phase === "paused";
  return (
    <div className="card space-y-5 p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">{m.record.name}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.record.namePlaceholder} disabled={phase === "uploading"} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">{m.record.mic}</label>
        <select className="input" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={active || phase === "uploading"}>
          <option value="">{devices.find((d) => d.deviceId === "default")?.label || "Default"}</option>
          {devices
            .filter((d) => d.deviceId && d.deviceId !== "default")
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId.slice(0, 8)}
              </option>
            ))}
        </select>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-200 py-8 dark:border-zinc-800">
        <div className="font-mono text-5xl tabular-nums">{formatTime(elapsed, true)}</div>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          {phase === "recording" && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
          {phase === "recording" ? m.record.recording : phase === "paused" ? m.record.paused : phase === "uploading" ? m.record.uploading : " "}
        </div>
        <div className="h-1.5 w-64 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
          <div className="h-full bg-emerald-500 transition-[width] duration-150" style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {phase === "uploading" && progress != null && (
          <div className="h-2 w-64 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap justify-center gap-2">
        {phase === "idle" && (
          <button className="btn btn-primary px-6 py-3 text-base" onClick={start}>
            {m.record.start}
          </button>
        )}
        {phase === "recording" && (
          <button className="btn px-5 py-3" onClick={pause}>
            {m.record.pause}
          </button>
        )}
        {phase === "paused" && (
          <button className="btn px-5 py-3" onClick={resume}>
            {m.record.resume}
          </button>
        )}
        {active && (
          <button className="btn btn-primary px-6 py-3 text-base" onClick={stopAndUpload}>
            {m.record.stop}
          </button>
        )}
        {active && (
          <button className="btn btn-danger px-5 py-3" onClick={discard}>
            {m.record.discard}
          </button>
        )}
      </div>
    </div>
  );
}
