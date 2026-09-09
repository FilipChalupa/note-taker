import subprocess

from worker import gpu
from worker.pipeline import _clean_embeddings


def test_clean_embeddings_drops_nan_and_converts_arrays():
    class Arr:
        def __init__(self, v):
            self.v = v

        def tolist(self):
            return self.v

    out = _clean_embeddings({"SPEAKER_00": Arr([0.123456, -1.0]), "SPEAKER_01": [float("nan"), 1.0], "SPEAKER_02": []})
    assert out == {"SPEAKER_00": [0.12346, -1.0]}
    assert _clean_embeddings(None) is None


def test_gpu_query_parses_nvidia_smi(monkeypatch):
    monkeypatch.setattr(gpu.shutil, "which", lambda name: "/usr/bin/nvidia-smi")

    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args, 0, stdout="27, 44, 29.28, 2998, 12288\n", stderr="")

    monkeypatch.setattr(gpu.subprocess, "run", fake_run)
    gpu._CACHE.update(at=0.0, value=None)
    assert gpu.query() == {"utilization_pct": 27, "temperature_c": 44, "power_w": 29.3, "memory_used_mb": 2998, "memory_total_mb": 12288}


def test_gpu_query_without_nvidia_smi(monkeypatch):
    monkeypatch.setattr(gpu.shutil, "which", lambda name: None)
    gpu._CACHE.update(at=0.0, value=None)
    assert gpu.query() is None


def test_result_carries_embeddings(client, tone_file):
    import time

    with tone_file.open("rb") as f:
        task_id = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")}).json()["task_id"]
    for _ in range(100):
        if client.get(f"/tasks/{task_id}/status").json()["status"] in ("COMPLETED", "FAILED"):
            break
        time.sleep(0.1)
    res = client.get(f"/tasks/{task_id}/result").json()
    assert "speaker_embeddings" in res
