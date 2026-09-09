"""Fake worker for web end-to-end tests.

Runs the real FastAPI app, queue, ffmpeg conversion and ETA logic, but replaces the ML pipeline
with canned transcripts so no GPU, model download or Hugging Face token is needed.

Env:
  PORT                 listen port (default 8765)
  STUB_DATA            data dir (default: temp dir)
  STUB_PHASE_SECONDS   sleep per phase (default 0.3) - raise it to keep the queue visible
  STUB_FAKE_CUDA=1     report a fake RTX 3080 in /health
"""
import os
import sys
import tempfile
import time
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["WORKER_DATA_DIR"] = os.environ.get("STUB_DATA") or tempfile.mkdtemp(prefix="stub-worker-")
os.environ["WORKER_API_KEY"] = ""
os.environ["HF_TOKEN"] = "stub"
os.environ["DIARIZATION_ENABLED"] = "1"
os.environ["TASK_TTL_HOURS"] = "0"
PHASE = float(os.environ.get("STUB_PHASE_SECONDS", "0.3"))

if os.environ.get("STUB_FAKE_CUDA") == "1":
    fake_torch = types.ModuleType("torch")

    class _cuda:  # noqa: N801
        @staticmethod
        def is_available():
            return True

        @staticmethod
        def mem_get_info():
            return (int(8.4 * 1024**3), int(12 * 1024**3))

        @staticmethod
        def get_device_name(i=0):
            return "NVIDIA GeForce RTX 3080"

        @staticmethod
        def empty_cache():
            pass

    fake_torch.cuda = _cuda
    sys.modules["torch"] = fake_torch

from worker import pipeline as P  # noqa: E402

SEGMENTS = [
    {"start": 0.0, "end": 2.5, "speaker": "SPEAKER_00", "text": "Ahoj, jak se máš?",
     "words": [{"word": "Ahoj,", "start": 0.0, "end": 0.5}, {"word": "jak", "start": 0.6, "end": 0.9},
               {"word": "se", "start": 1.0, "end": 1.2}, {"word": "máš?", "start": 1.3, "end": 2.5}]},
    {"start": 2.6, "end": 5.0, "speaker": "SPEAKER_01", "text": "Dobře, díky.",
     "words": [{"word": "Dobře,", "start": 2.6, "end": 3.5}, {"word": "díky.", "start": 3.6, "end": 5.0}]},
    {"start": 5.1, "end": 7.9, "speaker": "SPEAKER_00", "text": "Tak začneme.",
     "words": [{"word": "Tak", "start": 5.1, "end": 5.6}, {"word": "začneme.", "start": 5.7, "end": 7.9}]},
]


def _embedding(seed: int, dims: int = 32) -> list[float]:
    """Deterministic unit vector per seed, so the same 'voice' recurs across stub recordings."""
    import math
    import random

    rnd = random.Random(seed)
    vec = [rnd.gauss(0, 1) for _ in range(dims)]
    norm = math.sqrt(sum(v * v for v in vec))
    return [round(v / norm, 5) for v in vec]


EMBEDDINGS = {"SPEAKER_00": _embedding(1), "SPEAKER_01": _embedding(2)}


def fake_run(self, audio_path, language, min_speakers, max_speakers, progress, initial_prompt=None, **kw):
    progress("TRANSCRIBING", 30, 0.3)
    time.sleep(PHASE)
    progress("DIARIZING", 80, 0.5)
    time.sleep(PHASE)
    return {"language": language or "cs", "diarized": True, "diarization_error": None,
            "speakers": ["SPEAKER_00", "SPEAKER_01"],
            "segments": [{**s, "words": [dict(w) for w in s["words"]]} for s in SEGMENTS],
            "speaker_embeddings": {k: list(v) for k, v in EMBEDDINGS.items()}}


def fake_diarize(self, audio_path, segments, min_speakers, max_speakers, progress):
    progress("DIARIZING", 50, 0.5)
    time.sleep(PHASE)
    out = []
    for i, seg in enumerate(segments):
        seg = dict(seg)
        seg["speaker"] = f"SPEAKER_0{i % 3}"
        out.append(seg)
    speakers = sorted({s["speaker"] for s in out})
    return {"diarized": True, "diarization_error": None, "speakers": speakers, "segments": out,
            "speaker_embeddings": {sp: _embedding(i + 1) for i, sp in enumerate(speakers)}}


P.Pipeline.run = fake_run
P.Pipeline.diarize_only = fake_diarize

if __name__ == "__main__":
    import uvicorn
    from worker.main import app

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "8765")), log_level="warning")
