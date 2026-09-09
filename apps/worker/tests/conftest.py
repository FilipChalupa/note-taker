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


P.Pipeline.run = fake_run
P.Pipeline.diarize_only = fake_diarize


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
