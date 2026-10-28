"""Multi-track recordings: stream roles, merging per-track transcripts, joining voices, dropping bleed, API."""
import json
import time

import numpy as np
import pytest

from worker import tracks as T


def wait_done(client, task_id, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = client.get(f"/tasks/{task_id}/status").json()
        if st["status"] in ("COMPLETED", "FAILED"):
            return st
        time.sleep(0.1)
    raise AssertionError("task did not finish")


def bursts(on, n=400, level=0.3, noise=1e-4, seed=0):
    """Frame levels: `level` where `on(i)` holds, room noise elsewhere."""
    rng = np.random.default_rng(seed)
    base = noise * (1 + 0.1 * rng.random(n))
    return np.where([on(i) for i in range(n)], level, base)


# ------------------------------------------------------------------ specs
def test_parse_track_specs_validates():
    specs = T.parse_track_specs([{"index": 2, "name": " Filip ", "max_speakers": 1}, {"index": 1}])
    assert [s.index for s in specs] == [1, 2]
    assert specs[1].name == "Filip" and specs[1].max_speakers == 1 and specs[0].use is True
    for bad in ([], [{"index": -1}], [{"index": 1}, {"index": 1}], [{"index": 0, "use": False}],
                [{"index": 0, "min_speakers": 3, "max_speakers": 2}], [{"index": "0"}], "x"):
        with pytest.raises(ValueError):
            T.parse_track_specs(bad)


# ------------------------------------------------------------------ roles
def test_classify_finds_mix_silent_and_duplicate():
    desktop = bursts(lambda i: i % 20 < 8)
    mic = bursts(lambda i: i % 20 >= 12, level=0.02, seed=1)
    mix = np.sqrt(desktop ** 2 + mic ** 2)
    silent = np.full(400, 1e-5)
    assert T.classify_tracks([mix, desktop, mic, silent]) == ["mix", "speech", "speech", "silent"]
    # the mix may come last too
    assert T.classify_tracks([desktop, mic, mix]) == ["speech", "speech", "mix"]
    # in-person meeting: empty desktop track, mix == microphone -> keep the microphone
    assert T.classify_tracks([mic.copy(), silent, mic]) == ["duplicate", "silent", "speech"]
    # two separate speakers stay separate
    assert T.classify_tracks([desktop, mic]) == ["speech", "speech"]
    assert T.classify_tracks([None, desktop]) == ["silent", "speech"]


# ------------------------------------------------------------------ merging
def seg(start, end, speaker, text, **kw):
    return {"start": start, "end": end, "speaker": speaker, "text": text, "words": None, **kw}


def test_merge_track_results_renumbers_and_tags_tracks():
    out = T.merge_track_results([
        (1, {"speakers": ["SPEAKER_00", "SPEAKER_01"], "segments": [seg(0, 1, "SPEAKER_00", "a"), seg(3, 4, "SPEAKER_01", "c")],
             "speaker_embeddings": {"SPEAKER_00": [1, 0], "SPEAKER_01": [0, 1]}}),
        (2, {"speakers": ["SPEAKER_00"], "segments": [seg(1, 2, "SPEAKER_00", "b",
                                                          words=[{"word": "b", "start": 1, "end": 2, "speaker": "SPEAKER_00"}])],
             "speaker_embeddings": {"SPEAKER_00": [1, 1]}}),
    ])
    assert [(s["text"], s["speaker"], s["track"]) for s in out["segments"]] == [
        ("a", "SPEAKER_00", 1), ("b", "SPEAKER_02", 2), ("c", "SPEAKER_01", 1)]
    assert out["segments"][1]["words"][0]["speaker"] == "SPEAKER_02"
    assert out["track_speakers"] == {1: ["SPEAKER_00", "SPEAKER_01"], 2: ["SPEAKER_02"]}
    assert out["speaker_embeddings"]["SPEAKER_02"] == [1, 1]


def test_merge_similar_voices_joins_one_person_split_in_two():
    segments = [seg(0, 1, "SPEAKER_00", "a"), seg(1, 2, "SPEAKER_01", "b"), seg(2, 3, "SPEAKER_02", "c")]
    emb = {"SPEAKER_00": [1.0, 0.0, 0.1], "SPEAKER_01": [0.9, 0.1, 0.2], "SPEAKER_02": [0.0, 1.0, 0.0]}
    out, merged, mapping = T.merge_similar_voices(segments, emb, 0.6)
    assert mapping == {"SPEAKER_01": "SPEAKER_00"}
    assert [s["speaker"] for s in out] == ["SPEAKER_00", "SPEAKER_00", "SPEAKER_02"]
    assert set(merged) == {"SPEAKER_00", "SPEAKER_02"}
    # disabled, or nothing similar enough
    assert T.merge_similar_voices(segments, emb, 0)[2] == {}
    assert T.merge_similar_voices(segments, emb, 0.999)[2] == {}
    renumbered, emb2, tracks = T.renumber_speakers(out, merged, {1: ["SPEAKER_00", "SPEAKER_02"]})
    assert [s["speaker"] for s in renumbered] == ["SPEAKER_00", "SPEAKER_00", "SPEAKER_01"]
    assert tracks == {1: ["SPEAKER_00", "SPEAKER_01"]} and set(emb2) == {"SPEAKER_00", "SPEAKER_01"}


def test_drop_bleed_keeps_the_louder_copy():
    frames = 200  # 10 s of 50 ms frames
    loud, quiet = np.full(frames, 0.3), np.full(frames, 0.01)
    segments = [
        seg(0.0, 2.0, "SPEAKER_00", "Tak jo, začneme tím rozpočtem.", track=1),
        seg(0.1, 2.1, "SPEAKER_01", "Tak jo začneme tím rozpočtem", track=2),  # heard through the speaker
        seg(1.0, 1.5, "SPEAKER_01", "Mhm.", track=2),  # a real interjection at the same time
        seg(3.0, 4.0, "SPEAKER_01", "Tak jo, začneme tím rozpočtem.", track=2),  # same words later: not bleed
    ]
    out, dropped = T.drop_bleed(segments, {1: loud, 2: quiet})
    assert dropped == 1
    assert [(s["track"], s["text"]) for s in out] == [(1, segments[0]["text"]), (2, "Mhm."), (2, segments[3]["text"])]
    # the other way round when track 1 is the quiet one
    out, _ = T.drop_bleed(segments, {1: quiet, 2: loud})
    assert out[0]["track"] == 2 and out[0]["start"] == 0.1


# ------------------------------------------------------------------ API
def test_obs_file_is_split_into_tracks_automatically(client, obs_file):
    from worker import pipeline as P

    with obs_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("obs.mka", f, "audio/x-matroska")}, data={"language": "cs"})
    assert r.status_code == 202
    st = wait_done(client, r.json()["task_id"])
    assert st["status"] == "COMPLETED", st
    res = client.get(f"/tasks/{st['task_id']}/result").json()
    assert [(t["index"], t["role"], t["used"]) for t in res["tracks"]] == [
        (0, "mix", False), (1, "speech", True), (2, "speech", True), (3, "silent", False)]
    call = P.Pipeline.run_tracks.calls[-1]
    assert [t["index"] for t in call["tracks"]] == [1, 2] and call["levels"] == [1, 2]
    assert [(s["track"], s["speaker"]) for s in res["segments"]] == [(1, "SPEAKER_00"), (2, "SPEAKER_01")]
    assert res["tracks"][1]["speakers"] == ["SPEAKER_00"] and res["tracks"][2]["speakers"] == ["SPEAKER_01"]
    assert res["tracks"][1]["quality"] is not None
    assert res["speakers"] == ["SPEAKER_00", "SPEAKER_01"]
    assert client.get(f"/tasks/{st['task_id']}/audio").status_code == 200  # playback mix of the used tracks


def test_requested_tracks_names_and_speaker_counts(client, obs_file):
    from worker import pipeline as P

    tracks = [{"index": 1, "name": "Online"}, {"index": 2, "name": "Filip", "max_speakers": 1}]
    with obs_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("obs.mka", f, "audio/x-matroska")}, data={"tracks": json.dumps(tracks)})
    st = wait_done(client, r.json()["task_id"])
    res = client.get(f"/tasks/{st['task_id']}/result").json()
    assert [(t["index"], t["name"], t["used"]) for t in res["tracks"]] == [
        (0, None, False), (1, "Online", True), (2, "Filip", True), (3, None, False)]
    assert P.Pipeline.run_tracks.calls[-1]["tracks"][1]["max_speakers"] == 1


def test_single_track_file_is_unchanged(client, tone_file):
    with tone_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")})
    res = client.get(f"/tasks/{wait_done(client, r.json()['task_id'])['task_id']}/result").json()
    assert res["tracks"] is None
    assert all(s.get("track") is None for s in res["segments"])


def test_tracks_validation(client, obs_file, tone_file):
    with obs_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("obs.mka", f, "audio/x-matroska")}, data={"tracks": "[{\"index\": 7}]"})
    assert r.status_code == 400 and "no track 7" in r.json()["detail"]
    r = client.post("/transcribe", files={"file": ("tone.m4a", tone_file.read_bytes(), "audio/mp4")}, data={"tracks": "nope"})
    assert r.status_code == 400


def test_multitrack_speakers_only_rerun(client, obs_file):
    from worker import pipeline as P

    segments = [seg(0, 1, "SPEAKER_00", "a", track=1), seg(1, 2, "SPEAKER_05", "b", track=2)]
    with obs_file.open("rb") as f:
        r = client.post("/diarize", files={"file": ("obs.mka", f, "audio/x-matroska")},
                        data={"segments": json.dumps(segments), "tracks": json.dumps([{"index": 1}, {"index": 2, "max_speakers": 1}])})
    assert r.status_code == 202
    st = wait_done(client, r.json()["task_id"])
    assert st["status"] == "COMPLETED", st
    res = client.get(f"/tasks/{st['task_id']}/result").json()
    assert [(s["text"], s["speaker"], s["track"]) for s in res["segments"]] == [("a", "SPEAKER_00", 1), ("b", "SPEAKER_01", 2)]
    assert [t["index"] for t in P.Pipeline.diarize_only_tracks.calls[-1]["tracks"]] == [1, 2]
