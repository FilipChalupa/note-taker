import assert from "node:assert/strict";
import { test } from "node:test";
import { createInputMonitor } from "../src/input-monitor.ts";

const frame = (amplitude: number, n = 1024) => Float32Array.from({ length: n }, (_, i) => amplitude * Math.sin(i / 5));

test("a silent input is counted in seconds until sound comes back", () => {
  let t = 0;
  const monitor = createInputMonitor({}, () => t);
  assert.equal(monitor.push(frame(0)).silentSeconds, 0);
  t = 4_900;
  assert.equal(monitor.push(frame(0.0005)).silentSeconds, 4); // room noise of a muted input still counts as silence
  t = 12_000;
  const silent = monitor.push(frame(0));
  assert.equal(silent.silentSeconds, 12);
  assert.equal(silent.level, 0);
  t = 12_200;
  const speech = monitor.push(frame(0.2));
  assert.equal(speech.silentSeconds, 0);
  assert.ok(speech.level > 0.3 && speech.level <= 1);
});

test("reset starts the silence count again, e.g. after a pause", () => {
  let t = 0;
  const monitor = createInputMonitor({}, () => t);
  t = 60_000;
  monitor.reset();
  t = 61_000;
  assert.equal(monitor.push(frame(0)).silentSeconds, 1);
});

test("clipping needs several full-scale frames close together and wears off", () => {
  let t = 0;
  const monitor = createInputMonitor({}, () => t);
  assert.equal(monitor.push(frame(1)).clipping, false); // one loud frame is not clipping
  t = 200;
  monitor.push(frame(1));
  t = 400;
  assert.equal(monitor.push(frame(1)).clipping, true);
  t = 6_000;
  assert.equal(monitor.push(frame(0.2)).clipping, false);
});
