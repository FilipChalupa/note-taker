/**
 * How well a recording can be transcribed, judged from its levels: the worker measures the original upload,
 * the recorder measures a short microphone test before a meeting. Both use the same thresholds.
 */

/** Measured by the worker on the original upload, in dBFS. Speech = frames at least 10 dB above the noise floor. */
export interface AudioQuality {
  speech_db: number;
  noise_db: number;
  snr_db: number;
  /** share of samples at full scale, 0..1 */
  clipped_share: number;
  /** share of the recording that is speech, 0..1 */
  speech_share: number;
}

export type AudioQualityIssue = "noisy" | "quiet" | "clipping";

/** Below this speech-to-noise margin words start to drown; Whisper then guesses more. */
export const MIN_SNR_DB = 15;
/** Speech this quiet sits close to the noise of the input chain even in a silent room. */
export const MIN_SPEECH_DB = -40;
/** More than one sample in a thousand at full scale is audible distortion. */
export const MAX_CLIPPED_SHARE = 0.001;

export function audioQualityIssues(q: Pick<AudioQuality, "speech_db" | "snr_db" | "clipped_share">): AudioQualityIssue[] {
  const issues: AudioQualityIssue[] = [];
  if (q.snr_db < MIN_SNR_DB) issues.push("noisy");
  if (q.speech_db < MIN_SPEECH_DB) issues.push("quiet");
  if (q.clipped_share > MAX_CLIPPED_SHARE) issues.push("clipping");
  return issues;
}

/** One analyser frame of the microphone test: RMS and peak of samples in −1..1. */
export interface LevelFrame {
  rms: number;
  peak: number;
}

export interface MicTestResult {
  /** "silent": nothing that could be speech was heard; the levels are then null */
  verdict: "ok" | "silent" | AudioQualityIssue;
  speechDb: number | null;
  noiseDb: number | null;
  snrDb: number | null;
}

const toDb = (v: number) => Math.round(20 * Math.log10(Math.max(v, 1e-5)) * 10) / 10;

/**
 * Judges a few seconds of talking into the microphone. The noise floor is the quietest tenth of the frames
 * (the gaps between words, the breath before the first one), speech is what stands at least 10 dB above it.
 */
export function assessMicTest(frames: LevelFrame[]): MicTestResult {
  const silent: MicTestResult = { verdict: "silent", speechDb: null, noiseDb: null, snrDb: null };
  const audible = frames.filter((f) => f.rms > 0.003); // same floor as the live silence warning
  if (audible.length < 5) return silent;
  const sorted = frames.map((f) => f.rms).sort((a, b) => a - b);
  const noise = Math.max(sorted[Math.floor(sorted.length * 0.1)], 1e-5);
  let speech = frames.filter((f) => f.rms > noise * 10 ** (10 / 20));
  if (speech.length < 5) speech = frames.filter((f) => f.rms > noise * 10 ** (6 / 20));
  if (speech.length < 5) return silent; // an even hum without a voice
  const speechRms = Math.sqrt(speech.reduce((a, f) => a + f.rms * f.rms, 0) / speech.length);
  const speechDb = toDb(speechRms);
  const noiseDb = toDb(noise);
  const snrDb = Math.round((speechDb - noiseDb) * 10) / 10;
  const clipped = frames.filter((f) => f.peak >= 0.99).length;
  const verdict = clipped >= 3 ? "clipping" : snrDb < MIN_SNR_DB ? "noisy" : speechDb < MIN_SPEECH_DB ? "quiet" : "ok";
  return { verdict, speechDb, noiseDb, snrDb };
}
