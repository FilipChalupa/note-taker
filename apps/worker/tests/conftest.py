"""Test setup: isolate the worker's data dir and never touch a real GPU / model."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

_DATA = tempfile.mkdtemp(prefix="worker-test-")
os.environ["WORKER_DATA_DIR"] = _DATA
os.environ["WORKER_API_KEY"] = ""
os.environ["HF_TOKEN"] = "test-token"
os.environ["DIARIZATION_ENABLED"] = "1"
os.environ["TASK_TTL_HOURS"] = "0"

from worker import pipeline as P  # noqa: E402

FAKE_SEGMENTS = [
    {"start": 0.0, "end": 2.5, "speaker": "SPEAKER_00", "text": "Ahoj, jak se máš?",
     "words": [{"word": "Ahoj,", "start": 0.0, "end": 0.5}, {"word": "jak", "start": 0.6, "end": 0.9},
               {"word": "se", "start": 1.0, "end": 1.2}, {"word": "máš?", "start": 1.3, "end": 2.5}]},
    {"start": 2.6, "end": 5.0, "speaker": "SPEAKER_01", "text": "Dobře, díky.", "words": None},
    {"start": 5.1, "end": 7.9, "speaker": "SPEAKER_00", "text": "Tak začneme.", "words": None},
]


def fake_run(self, audio_path, language, min_speakers, max_speakers, progress, initial_prompt=None, **kw):
    progress("TRANSCRIBING", 30, 0.3)
    progress("DIARIZING", 80, 0.5)
    fake_run.calls.append({"language": language, "initial_prompt": initial_prompt, "min": min_speakers, "max": max_speakers})
    return {"language": language or "cs", "diarized": True, "diarization_error": None,
            "speakers": ["SPEAKER_00", "SPEAKER_01"], "segments": [dict(s) for s in FAKE_SEGMENTS]}


fake_run.calls = []


def fake_diarize(self, audio_path, segments, min_speakers, max_speakers, progress):
    progress("DIARIZING", 50, 0.5)
    out = []
    for i, seg in enumerate(segments):
        seg = dict(seg)
        seg["speaker"] = f"SPEAKER_0{i % 3}"
        out.append(seg)
    return {"diarized": True, "diarization_error": None, "speakers": sorted({s["speaker"] for s in out}), "segments": out}


def fake_run_tracks(self, tracks, language, progress, initial_prompt=None, levels=None, merge_threshold=0.0):
    """Every track says one line as SPEAKER_00, at a time given by its position; merged by the real code."""
    progress("TRANSCRIBING", 30, 0.3)
    fake_run_tracks.calls.append({"tracks": tracks, "levels": sorted((levels or {}).keys())})
    per_track = []
    for k, tr in enumerate(tracks):
        seg = {"start": float(k), "end": k + 0.8, "speaker": "SPEAKER_00", "text": f"track {tr['index']}", "words": None}
        per_track.append((tr["index"], {"speakers": ["SPEAKER_00"], "segments": [seg],
                                        "speaker_embeddings": {"SPEAKER_00": [float(i == k) for i in range(len(tracks))]}}))
    out = P._merge_tracks(per_track, levels or {}, merge_threshold, drop_bleed=True)
    out.update({"language": language or "cs", "diarized": True, "diarization_error": None})
    return out


fake_run_tracks.calls = []


def fake_diarize_tracks(self, tracks, segments, progress, merge_threshold=0.0):
    fake_diarize_tracks.calls.append({"tracks": tracks, "segments": segments})
    per_track = [(tr["index"], {"speakers": ["SPEAKER_00"], "segments": [dict(s, speaker="SPEAKER_00") for s in segments if s.get("track") == tr["index"]],
                                "speaker_embeddings": None}) for tr in tracks]
    out = P._merge_tracks(per_track, {}, merge_threshold, drop_bleed=False)
    out.update({"diarized": True, "diarization_error": None})
    return out


fake_diarize_tracks.calls = []

P.Pipeline.run = fake_run
P.Pipeline.diarize_only = fake_diarize
P.Pipeline.run_tracks = fake_run_tracks
P.Pipeline.diarize_only_tracks = fake_diarize_tracks


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(_DATA, ignore_errors=True)


@pytest.fixture(scope="session")
def tone_file(tmp_path_factory) -> Path:
    """8 s sine tone as m4a (needs ffmpeg)."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("audio") / "tone.m4a"
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=8", "-c:a", "aac", str(path)], check=True)
    return path


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from worker.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def obs_file(tmp_path_factory) -> Path:
    """OBS-like recording, 12 s: stream 0 = mix of 1 and 2, stream 1 = "desktop" (tone bursts in the first
    half), stream 2 = "microphone" (bursts in the second half), stream 3 = silence."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    path = tmp_path_factory.mktemp("audio") / "obs.mka"
    desktop = "sine=frequency=300:duration=12,volume='if(lt(t,6),if(lt(mod(t,1),0.5),1,0),0)':eval=frame,volume=0.5"
    mic = "sine=frequency=500:duration=12,volume='if(gte(t,6),if(lt(mod(t,1),0.5),1,0),0)':eval=frame,volume=0.2"
    graph = (f"{desktop},asplit[d1][d2];{mic},asplit[m1][m2];[d1][m1]amix=inputs=2:normalize=0[mix];"
             "anullsrc=r=16000:cl=mono,atrim=duration=12[sil]")
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-filter_complex", graph,
                    "-map", "[mix]", "-map", "[d2]", "-map", "[m2]", "-map", "[sil]", "-c:a", "flac", str(path)], check=True)
    return path
