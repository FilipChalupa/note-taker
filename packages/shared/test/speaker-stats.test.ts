import assert from "node:assert/strict";
import { test } from "node:test";
import { computeSpeakerStats } from "../src/speaker-stats.ts";

const seg = (start: number, end: number, speaker: string, text: string) => ({ start, end, speaker, text });

test("turns are runs of the same speaker, shares add up to one", () => {
  const stats = computeSpeakerStats(
    [seg(0, 4, "A", "one two three"), seg(4, 6, "A", "four"), seg(6, 9, "B", "five six"), seg(9, 10, "A", "seven")],
    ["A", "B"],
  );
  assert.deepEqual(
    stats.rows.map((r) => [r.speaker, r.seconds, r.turns, r.words]),
    [
      ["A", 7, 2, 5],
      ["B", 3, 1, 2],
    ],
  );
  assert.equal(stats.totalSeconds, 10);
  assert.equal(stats.speakerChanges, 2);
  assert.equal(stats.longestTurnSeconds, 6); // A: 0-4 plus 4-6
  assert.equal(Math.round(stats.rows.reduce((a, r) => a + r.share, 0) * 1000) / 1000, 1);
});

test("speaker order is respected and unknown speakers follow by first appearance", () => {
  const stats = computeSpeakerStats([seg(0, 1, "X", "a"), seg(1, 2, "B", "b"), seg(2, 3, "A", "c")], ["A", "B"]);
  assert.deepEqual(
    stats.rows.map((r) => r.speaker),
    ["A", "B", "X"],
  );
});

test("empty and zero-length transcripts do not divide by zero", () => {
  assert.deepEqual(computeSpeakerStats([]), { rows: [], totalSeconds: 0, speakerChanges: 0, longestTurnSeconds: 0 });
  const zero = computeSpeakerStats([seg(5, 5, "A", "")]);
  assert.equal(zero.rows[0].share, 0);
  assert.equal(zero.rows[0].words, 0);
  // negative durations from bad timestamps count as zero
  assert.equal(computeSpeakerStats([seg(5, 3, "A", "x")]).totalSeconds, 0);
});
