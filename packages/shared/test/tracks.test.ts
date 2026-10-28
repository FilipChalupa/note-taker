import assert from "node:assert/strict";
import { test } from "node:test";
import { trackSpeakerNames, tracksToSpecs, validateTrackSpecs } from "../src/tracks.ts";
import type { TrackInfo } from "../src/index.ts";

const track = (index: number, over: Partial<TrackInfo> = {}): TrackInfo => ({
  index,
  name: null,
  title: null,
  role: "speech",
  used: true,
  min_speakers: null,
  max_speakers: null,
  quality: null,
  speakers: [],
  ...over,
});

test("a named track with one speaker names that speaker", () => {
  const tracks = [
    track(0, { role: "mix", used: false, name: "Mix" }),
    track(1, { name: "Online", speakers: ["SPEAKER_00", "SPEAKER_01"] }),
    track(2, { name: " Filip ", speakers: ["SPEAKER_02"] }),
    track(3, { speakers: ["SPEAKER_03"] }),
  ];
  assert.deepEqual(trackSpeakerNames(tracks), { SPEAKER_02: "Filip" });
  assert.deepEqual(trackSpeakerNames(null), {});
});

test("a finished run becomes the request for the next one", () => {
  assert.deepEqual(tracksToSpecs([track(0, { used: false, role: "mix" }), track(2, { name: "Filip", max_speakers: 1 })]), [
    { index: 0, name: null, use: false, min_speakers: null, max_speakers: null },
    { index: 2, name: "Filip", use: true, min_speakers: null, max_speakers: 1 },
  ]);
});

test("track requests are validated", () => {
  assert.deepEqual(validateTrackSpecs([{ index: 2, name: " Filip ", max_speakers: "1" }, { index: 1, use: false }]), {
    tracks: [
      { index: 1, name: null, use: false, min_speakers: null, max_speakers: null },
      { index: 2, name: "Filip", use: true, min_speakers: null, max_speakers: 1 },
    ],
  });
  assert.deepEqual(validateTrackSpecs([{ index: 0, use: false }]), { error: "TRACKS_NONE_USED" });
  assert.deepEqual(validateTrackSpecs([{ index: 0, min_speakers: 3, max_speakers: 2 }]), { error: "SPEAKER_RANGE" });
  for (const bad of [[], "x", [{ index: -1 }], [{ index: 1 }, { index: 1 }], [{ index: 0, max_speakers: 0 }], [null]]) {
    assert.deepEqual(validateTrackSpecs(bad), { error: "TRACKS_INVALID" });
  }
});
