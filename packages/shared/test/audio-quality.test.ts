import assert from "node:assert/strict";
import { test } from "node:test";
import { assessMicTest, audioQualityIssues, type LevelFrame } from "../src/audio-quality.ts";

/** A second of room noise, then talking with short gaps between words. */
const talk = (speech: number, noise: number, peak = speech * 1.5): LevelFrame[] => [
  ...Array.from({ length: 20 }, () => ({ rms: noise, peak: noise * 2 })),
  ...Array.from({ length: 80 }, (_, i) => (i % 8 === 7 ? { rms: noise, peak: noise * 2 } : { rms: speech, peak })),
];

test("a worker report without problems has no issues", () => {
  assert.deepEqual(audioQualityIssues({ speech_db: -27, snr_db: 27, clipped_share: 0 }), []);
});

test("noise, a quiet voice and clipping are reported, each on its own", () => {
  assert.deepEqual(audioQualityIssues({ speech_db: -30, snr_db: 9, clipped_share: 0 }), ["noisy"]);
  assert.deepEqual(audioQualityIssues({ speech_db: -46, snr_db: 22, clipped_share: 0 }), ["quiet"]);
  assert.deepEqual(audioQualityIssues({ speech_db: -8, snr_db: 40, clipped_share: 0.02 }), ["clipping"]);
  assert.deepEqual(audioQualityIssues({ speech_db: -46, snr_db: 9, clipped_share: 0.02 }), ["noisy", "quiet", "clipping"]);
});

test("microphone test: a normal voice in a quiet room is fine", () => {
  const res = assessMicTest(talk(0.08, 0.002));
  assert.equal(res.verdict, "ok");
  assert.ok(res.speechDb! > -23 && res.speechDb! < -21);
  assert.ok(res.noiseDb! > -55 && res.noiseDb! < -53);
  assert.ok(res.snrDb! > 31 && res.snrDb! < 33);
});

test("microphone test: a muted input and a hum without a voice both count as silent", () => {
  assert.equal(assessMicTest(talk(0, 0)).verdict, "silent");
  assert.equal(assessMicTest(Array.from({ length: 100 }, () => ({ rms: 0.02, peak: 0.04 }))).verdict, "silent");
  assert.equal(assessMicTest([]).verdict, "silent");
});

test("microphone test: noise, a quiet voice and clipping", () => {
  assert.equal(assessMicTest(talk(0.03, 0.01)).verdict, "noisy");
  assert.equal(assessMicTest(talk(0.006, 0.0005)).verdict, "quiet");
  assert.equal(assessMicTest(talk(0.5, 0.002, 1)).verdict, "clipping");
});
