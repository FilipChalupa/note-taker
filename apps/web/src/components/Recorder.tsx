"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { assessMicTest, createInputMonitor, type LevelFrame, type MicTestResult, type RecordingDetail } from "@note-taker/shared";
import { formatDate, formatDuration, formatTime } from "@/lib/format";
import { fmt } from "@/lib/i18n";
import { useI18n } from "@/lib/i18n/client";
import { recordingStore, type RecordingSession } from "@/lib/recording-store";
import { requestWorkerRefresh } from "./WorkerStatus";

type Phase = "idle" | "recording" | "paused" | "uploading";
type Source = "mic" | "display" | "both";

/** After this long without any sound the recorder says so: a muted or wrong microphone is otherwise found out
 *  only when the transcript comes back empty. */
const SILENCE_WARNING_SECONDS = 10;
/** Long enough for a breath of room noise and a couple of sentences. */
const MIC_TEST_SECONDS = 6;
const SOURCE_KEY = "recorder.source";
const DEVICE_KEY = "recorder.deviceId";
const SUPPRESS_KEY = "recorder.noiseSuppression";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function pickMime(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return candidates.find((c) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) ?? "";
}

/** In-browser recorder: MediaRecorder -> Blob -> POST /api/recordings. */
export function Recorder() {
  const { locale, m, tz } = useI18n();
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  const [displaySupported, setDisplaySupported] = useState(false);
  const [source, setSource] = useState<Source>("mic");
  const [notice, setNotice] = useState<string | null>(null);
  const [recoveries, setRecoveries] = useState<Array<RecordingSession & { chunks: number; bytes: number }>>([]);
  const sessionId = useRef<string | null>(null);
  const chunkSeq = useRef(0);
  const displayStream = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  // the browser's noise suppression: off by default (more natural), worth switching on in a noisy room
  const [suppress, setSuppress] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [silentSeconds, setSilentSeconds] = useState(0);
  const [clipping, setClipping] = useState(false);
  const monitor = useRef(createInputMonitor());
  const [micTest, setMicTest] = useState<{ left: number } | MicTestResult | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
    setDisplaySupported(typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function");
    if (recordingStore.available()) void recordingStore.listSessions().then((s) => setRecoveries(s.filter((x) => x.chunks > 0))).catch(() => {});
    // the source and the microphone picked last time (read after mount: the server render has no localStorage)
    const savedSource = readPref(SOURCE_KEY);
    if (savedSource === "mic" || savedSource === "both" || (savedSource === "display" && typeof navigator.mediaDevices?.getDisplayMedia === "function")) setSource(savedSource);
    const savedDevice = readPref(DEVICE_KEY);
    if (savedDevice) setDeviceId(savedDevice);
    setSuppress(readPref(SUPPRESS_KEY) === "1");
  }, []);

  // Enumerate mics (labels appear after the first permission grant)
  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const inputs = all.filter((d) => d.kind === "audioinput");
      setDevices(inputs);
      // a remembered microphone that is no longer plugged in falls back to the default (ids are only listed
      // once permission was granted, so an empty id means "not known yet", not "gone")
      if (inputs.some((d) => d.deviceId)) setDeviceId((id) => (id && !inputs.some((d) => d.deviceId === id) ? "" : id));
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
        const buf = new Float32Array(a.fftSize);
        a.getFloatTimeDomainData(buf);
        const health = monitor.current.push(buf);
        setLevel(health.level);
        setSilentSeconds(health.silentSeconds);
        setClipping(health.clipping);
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
    displayStream.current?.getTracks().forEach((t) => t.stop());
    displayStream.current = null;
    recorder.current = null;
    analyser.current = null;
    void audioCtx.current?.close().catch(() => {});
    audioCtx.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const micConstraints = (): MediaStreamConstraints => ({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: source === "both", noiseSuppression: suppress, autoGainControl: true },
  });

  /** A few seconds of talking before the meeting: the same microphone and settings as the recording itself,
   *  judged the way the worker later judges the upload. Nothing is stored. */
  const runMicTest = async () => {
    setError(null);
    setMicTest({ left: MIC_TEST_SECONDS });
    let mic: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia(micConstraints());
      void refreshDevices();
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 2048;
      ctx.createMediaStreamSource(mic).connect(an);
      const buf = new Float32Array(an.fftSize);
      const frames: LevelFrame[] = [];
      const started = Date.now();
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            sum += buf[i] * buf[i];
            peak = Math.max(peak, Math.abs(buf[i]));
          }
          const rms = Math.sqrt(sum / buf.length);
          frames.push({ rms, peak });
          const left = MIC_TEST_SECONDS - (Date.now() - started) / 1000;
          if (left <= 0 || !mounted.current) {
            clearInterval(timer);
            resolve();
            return;
          }
          setLevel(Math.min(1, rms * 3.2));
          setMicTest({ left: Math.ceil(left) });
        }, 50);
      });
      // the first quarter of a second is the microphone opening, not the room
      setMicTest(assessMicTest(frames.slice(5)));
    } catch (err) {
      const name = (err as Error).name;
      setError(name === "NotAllowedError" ? m.record.micDenied : (err as Error).message);
      setMicTest(null);
    } finally {
      mic?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => {});
      setLevel(0);
    }
  };
  const micTestRunning = micTest !== null && "left" in micTest;

  const start = async () => {
    setError(null);
    setNotice(null);
    setMicTest(null);
    try {
      let mic: MediaStream | null = null;
      let display: MediaStream | null = null;
      if (source === "mic" || source === "both") {
        mic = await navigator.mediaDevices.getUserMedia(micConstraints());
        void refreshDevices();
      }
      if (source === "display" || source === "both") {
        // Chrome requires video: true to offer the "share audio" checkbox; the video track is dropped right away
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        display.getVideoTracks().forEach((t) => t.stop());
        if (display.getAudioTracks().length === 0) {
          display.getTracks().forEach((t) => t.stop());
          mic?.getTracks().forEach((t) => t.stop());
          setError(m.record.noDisplayAudio);
          return;
        }
        displayStream.current = display;
        display.getAudioTracks()[0].onended = () => {
          if (source === "display") {
            setNotice(m.record.displayEndedStop);
            void stopAndUpload();
          } else setNotice(m.record.displayEnded);
        };
      }

      // Mix all sources through an AudioContext; also drives the level meter
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      for (const src of [mic, display]) {
        if (!src) continue;
        const node = ctx.createMediaStreamSource(new MediaStream(src.getAudioTracks()));
        node.connect(dest);
        node.connect(an);
      }
      audioCtx.current = ctx;
      analyser.current = an;
      stream.current = mic ?? display;

      const mime = pickMime();
      const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime, audioBitsPerSecond: 96_000 } : undefined);
      chunks.current = [];
      chunkSeq.current = 0;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionId.current = id;
      if (recordingStore.available()) {
        void recordingStore.createSession({ id, startedAt: new Date().toISOString(), title, mime: rec.mimeType || mime || "audio/webm", source }).catch(() => {});
      }
      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return;
        chunks.current.push(e.data);
        const seq = chunkSeq.current++;
        if (recordingStore.available()) void recordingStore.appendChunk(id, seq, e.data).catch(() => {});
      };
      rec.start(1000); // 1 s chunks: a crash loses at most a second
      recorder.current = rec;
      startedAt.current = Date.now();
      pausedTotal.current = 0;
      setElapsed(0);
      monitor.current.reset();
      setSilentSeconds(0);
      setClipping(false);
      setPhase("recording");
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        wakeLock.current = (await nav.wakeLock?.request("screen")) ?? null;
      } catch {
        /* optional */
      }
    } catch (err) {
      const name = (err as Error).name;
      setError(name === "NotAllowedError" ? m.record.micDenied : name === "NotSupportedError" ? m.record.displayUnsupported : (err as Error).message);
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
    monitor.current.reset();
    setSilentSeconds(0);
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

  const upload = async (blob: Blob, name: string, startedIso: string, storedSessionId: string | null) => {
    setPhase("uploading");
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    const stamp = startedIso.slice(0, 16).replace("T", "_").replace(":", "-");
    const filename = `recording_${stamp}.${ext}`;
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("title", name.trim() || `${m.record.title} ${stamp}`);
    setProgress(0);
    await new Promise<void>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/recordings");
      xhr.upload.onprogress = (ev) => ev.lengthComputable && setProgress(Math.round((ev.loaded / ev.total) * 100));
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const rec = JSON.parse(xhr.responseText) as RecordingDetail;
          if (storedSessionId && recordingStore.available()) void recordingStore.deleteSession(storedSessionId).catch(() => {});
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

  const stopAndUpload = async () => {
    if (!recorder.current || recorder.current.state === "inactive") return;
    setPhase("uploading");
    const blob = await finish();
    cleanup();
    await upload(blob, title, new Date(startedAt.current).toISOString(), sessionId.current);
  };

  const recoverUpload = async (session: RecordingSession) => {
    const blob = await recordingStore.loadBlob(session.id);
    if (!blob) return;
    await upload(blob, session.title, session.startedAt, session.id);
  };

  const recoverDiscard = async (session: RecordingSession) => {
    await recordingStore.deleteSession(session.id);
    setRecoveries((r) => r.filter((x) => x.id !== session.id));
  };

  const discard = async () => {
    if (recorder.current && recorder.current.state !== "inactive") await finish();
    cleanup();
    if (sessionId.current && recordingStore.available()) void recordingStore.deleteSession(sessionId.current).catch(() => {});
    sessionId.current = null;
    chunks.current = [];
    setPhase("idle");
    setElapsed(0);
    setLevel(0);
  };

  if (!supported) return <div className="card p-6 text-red-600">{m.record.unsupported}</div>;

  const active = phase === "recording" || phase === "paused";
  return (
    <div className="space-y-4">
      {recoveries.map((r) => (
        <div key={r.id} className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950" data-testid="recovery">
          <div className="font-medium text-amber-900 dark:text-amber-200">{m.record.recoveryTitle}</div>
          <div className="mt-1 text-amber-800 dark:text-amber-300">
            {fmt(m.record.recoveryText, { when: formatDate(r.startedAt, locale, tz), duration: formatDuration(r.chunks, m) })}
            {r.title && <> · „{r.title}“</>}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn btn-primary" onClick={() => recoverUpload(r)} disabled={phase === "uploading"}>
              {m.record.recoveryUpload}
            </button>
            <button className="btn" onClick={() => recoverDiscard(r)}>
              {m.record.recoveryDiscard}
            </button>
          </div>
        </div>
      ))}
    <div className="card space-y-5 p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">{m.record.name}</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.record.namePlaceholder} disabled={phase === "uploading"} />
      </div>
      {displaySupported && (
        <div>
          <label className="mb-1 block text-sm font-medium">{m.record.source}</label>
          <div className="space-y-1 text-sm">
            {(["mic", "display", "both"] as Source[]).map((opt) => (
              <label key={opt} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="source"
                  value={opt}
                  checked={source === opt}
                  onChange={() => {
                    setSource(opt);
                    writePref(SOURCE_KEY, opt);
                  }}
                  disabled={active || phase === "uploading" || micTestRunning}
                />
                {opt === "mic" ? m.record.sourceMic : opt === "display" ? m.record.sourceDisplay : m.record.sourceBoth}
              </label>
            ))}
          </div>
          {source !== "mic" && <p className="mt-1 text-xs text-zinc-500">{m.record.sourceDisplayHint}</p>}
        </div>
      )}
      {source !== "display" && (
      <div>
        <label className="mb-1 block text-sm font-medium">{m.record.mic}</label>
        <select
          className="input"
          value={deviceId}
          onChange={(e) => {
            setDeviceId(e.target.value);
            writePref(DEVICE_KEY, e.target.value);
          }}
          disabled={active || phase === "uploading" || micTestRunning}
        >
          <option value="">{devices.find((d) => d.deviceId === "default")?.label || "Default"}</option>
          {devices
            .filter((d) => d.deviceId && d.deviceId !== "default")
            .map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || d.deviceId.slice(0, 8)}
              </option>
            ))}
        </select>
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={suppress}
            onChange={(e) => {
              setSuppress(e.target.checked);
              writePref(SUPPRESS_KEY, e.target.checked ? "1" : "0");
            }}
            disabled={active || phase === "uploading" || micTestRunning}
          />
          {m.record.suppressNoise}
        </label>
        <p className="mt-1 text-xs text-zinc-500">{m.record.suppressNoiseHint}</p>
      </div>
      )}

      <div className="flex flex-col items-center gap-3 rounded-lg border border-zinc-200 py-8 dark:border-zinc-800">
        <div className="font-mono text-5xl tabular-nums">{formatTime(elapsed, true)}</div>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          {phase === "recording" && <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />}
          {phase === "recording" ? m.record.recording : phase === "paused" ? m.record.paused : phase === "uploading" ? m.record.uploading : " "}
        </div>
        <div className="h-1.5 w-64 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
          <div className={`h-full transition-[width] duration-150 ${clipping ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(level * 100)}%` }} />
        </div>
        {phase === "recording" && silentSeconds >= SILENCE_WARNING_SECONDS && (
          <p className="max-w-md rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200" role="alert" data-testid="silence-warning">
            {fmt(source === "display" ? m.record.silentDisplay : m.record.silentMic, { n: silentSeconds })}
          </p>
        )}
        {phase === "recording" && clipping && (
          <p className="max-w-md rounded-md border border-red-300 bg-red-50 px-3 py-2 text-center text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" role="alert" data-testid="clipping-warning">
            {m.record.clipping}
          </p>
        )}
        {phase === "idle" && micTest && <MicTestNote test={micTest} suppressOff={!suppress} />}
        {phase === "uploading" && progress != null && (
          <div className="h-2 w-64 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-700">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-amber-700 dark:text-amber-300">{notice}</p>}

      <div className="flex flex-wrap justify-center gap-2">
        {phase === "idle" && (
          <button className="btn btn-primary px-6 py-3 text-base" onClick={start} disabled={micTestRunning}>
            {m.record.start}
          </button>
        )}
        {phase === "idle" && source !== "display" && (
          <button className="btn px-5 py-3" onClick={runMicTest} disabled={micTestRunning}>
            {m.record.micTest}
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
      <p className="text-center text-xs text-zinc-500">{m.record.autosave}</p>
    </div>
    </div>
  );
}

/** The running countdown or the verdict of the microphone test. */
function MicTestNote({ test, suppressOff }: { test: { left: number } | MicTestResult; suppressOff: boolean }) {
  const { m } = useI18n();
  if ("left" in test) {
    return (
      <p className="max-w-md px-3 text-center text-sm text-zinc-600 dark:text-zinc-300" role="status" data-testid="mic-test">
        {fmt(m.record.micTestRunning, { n: test.left })}
      </p>
    );
  }
  const params = { speech: Math.round(test.speechDb ?? 0), snr: Math.round(test.snrDb ?? 0) };
  const ok = test.verdict === "ok";
  const text =
    test.verdict === "ok"
      ? fmt(m.record.micTestOk, params)
      : test.verdict === "silent"
        ? m.record.micTestSilent
        : test.verdict === "noisy"
          ? `${fmt(m.record.micTestNoisy, params)}${suppressOff ? ` ${m.record.micTestNoisyHint}` : ""}`
          : test.verdict === "quiet"
            ? fmt(m.record.micTestQuiet, params)
            : m.record.clipping;
  const tone = ok
    ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200";
  return (
    <p className={`max-w-md rounded-md border px-3 py-2 text-center text-sm ${tone}`} role="status" data-testid="mic-test" data-verdict={test.verdict}>
      {text}
    </p>
  );
}
