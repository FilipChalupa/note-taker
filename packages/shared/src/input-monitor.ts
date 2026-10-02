/**
 * Watches the level of a live recording and reports what a listener would notice too late:
 * an input that stays silent (muted or wrong microphone, a shared tab without audio) and an input that clips.
 * Pure and clock-injected, so it is the same in the web app, on the intake page and in tests.
 */

export interface InputHealth {
  /** 0..1 for the level meter */
  level: number;
  /** whole seconds since the last audible frame */
  silentSeconds: number;
  /** several full-scale frames within the last few seconds */
  clipping: boolean;
}

export interface InputMonitorOptions {
  /** RMS below this counts as silence; −50 dBFS: a muted input is digital zero, a live room is well above */
  silenceRms?: number;
  /** a frame with a sample at or above this is full scale */
  clipPeak?: number;
  /** this many full-scale frames within `clipWindowMs` mean clipping */
  clipFrames?: number;
  clipWindowMs?: number;
}

export function createInputMonitor(options: InputMonitorOptions = {}, now: () => number = () => Date.now()) {
  const silenceRms = options.silenceRms ?? 0.003;
  const clipPeak = options.clipPeak ?? 0.99;
  const clipFrames = options.clipFrames ?? 3;
  const clipWindowMs = options.clipWindowMs ?? 5000;
  let lastSound = now();
  let clips: number[] = [];

  return {
    /** Start counting from now: at the start of a recording and after a pause. */
    reset(): void {
      lastSound = now();
      clips = [];
    },
    /** Feed one frame of samples in −1..1 (an AnalyserNode's float time-domain data). */
    push(samples: ArrayLike<number>): InputHealth {
      const t = now();
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < samples.length; i++) {
        const v = samples[i];
        sum += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
      const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
      if (rms > silenceRms) lastSound = t;
      if (peak >= clipPeak) clips.push(t);
      clips = clips.filter((c) => t - c <= clipWindowMs);
      return {
        level: Math.min(1, rms * 3.2),
        silentSeconds: Math.floor((t - lastSound) / 1000),
        clipping: clips.length >= clipFrames,
      };
    },
  };
}
