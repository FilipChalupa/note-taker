import json
import time

from worker.config import settings
from worker.pipeline import pipeline


def wait_done(client, task_id, timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        st = client.get(f"/tasks/{task_id}/status").json()
        if st["status"] in ("COMPLETED", "FAILED"):
            return st
        time.sleep(0.1)
    raise AssertionError("task did not finish")


def test_health_reports_worker_state(client):
    h = client.get("/health").json()
    assert h["ok"] is True
    assert h["model"] == settings.model_name
    assert "cuda" in h and "queue" in h
    assert h["diarization_enabled"] is True


def test_transcribe_end_to_end(client, tone_file):
    with tone_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")},
                        data={"language": "cs", "min_speakers": "1", "max_speakers": "3", "initial_prompt": "Claritime, MVP."})
    assert r.status_code == 202
    task_id = r.json()["task_id"]

    st = wait_done(client, task_id)
    assert st["status"] == "COMPLETED"
    assert st["progress"] == 100
    assert st["duration"] and 7.5 < st["duration"] < 8.6
    assert st["filename"] == "tone.m4a"
    assert st["kind"] == "transcribe"

    res = client.get(f"/tasks/{task_id}/result").json()
    assert res["language"] == "cs"
    assert res["speakers"] == ["SPEAKER_00", "SPEAKER_01"]
    assert [s["text"] for s in res["segments"]][0] == "Ahoj, jak se máš?"
    assert res["audio_mime"] == "audio/mpeg"

    # the pipeline received the vocabulary prompt
    from worker import pipeline as P
    assert P.Pipeline.run.calls[-1]["initial_prompt"] == "Claritime, MVP."

    audio = client.get(f"/tasks/{task_id}/audio")
    assert audio.status_code == 200 and audio.headers["content-type"].startswith("audio/mpeg")

    assert client.delete(f"/tasks/{task_id}").status_code == 204
    assert client.get(f"/tasks/{task_id}/status").status_code == 404


def test_diarize_only_reuses_transcript(client, tone_file):
    segments = [{"start": 0, "end": 1, "speaker": "SPEAKER_00", "text": "a", "words": None},
                {"start": 1, "end": 2, "speaker": "SPEAKER_00", "text": "b", "words": None}]
    with tone_file.open("rb") as f:
        r = client.post("/diarize", files={"file": ("tone.m4a", f, "audio/mp4")},
                        data={"segments": json.dumps(segments), "language": "en", "min_speakers": "2", "max_speakers": "2"})
    assert r.status_code == 202
    st = wait_done(client, r.json()["task_id"])
    assert st["status"] == "COMPLETED" and st["kind"] == "diarize"
    res = client.get(f"/tasks/{st['task_id']}/result").json()
    assert res["kind"] == "diarize"
    assert [s["speaker"] for s in res["segments"]] == ["SPEAKER_00", "SPEAKER_01"]
    assert [s["text"] for s in res["segments"]] == ["a", "b"]


def test_validation_errors(client, tone_file):
    with tone_file.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")}, data={"min_speakers": "3", "max_speakers": "2"})
    assert r.status_code == 400
    r = client.post("/transcribe", files={"file": ("empty.wav", b"", "audio/wav")})
    assert r.status_code == 400
    r = client.post("/diarize", files={"file": ("tone.m4a", tone_file.read_bytes(), "audio/mp4")}, data={"segments": "not json"})
    assert r.status_code == 400
    assert client.get("/tasks/does-not-exist/status").status_code == 404


def test_api_key_is_enforced_when_configured(client, tone_file, monkeypatch):
    monkeypatch.setattr(settings, "api_key", "secret")
    assert client.get("/tasks?active_only=true").status_code == 401
    assert client.get("/tasks?active_only=true", headers={"X-API-Key": "secret"}).status_code == 200
    assert client.get("/health").status_code == 200  # health stays public


def test_diarization_failure_is_reported(client, tone_file, monkeypatch):
    from worker import pipeline as P

    def failing_run(self, audio_path, language, min_speakers, max_speakers, progress, initial_prompt=None, **kw):
        self.diarization_error = "GatedRepoError: test"
        return {"language": "cs", "diarized": False, "diarization_error": "GatedRepoError: test",
                "speakers": ["SPEAKER_00"], "segments": [{"start": 0, "end": 1, "speaker": "SPEAKER_00", "text": "x", "words": None}]}

    monkeypatch.setattr(P.Pipeline, "run", failing_run)
    with tone_file.open("rb") as f:
        task_id = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")}).json()["task_id"]
    wait_done(client, task_id)
    res = client.get(f"/tasks/{task_id}/result").json()
    assert res["diarized"] is False and "GatedRepoError" in res["diarization_error"]
    assert "GatedRepoError" in client.get("/health").json()["diarization_error"]
    pipeline.diarization_error = None


def test_diarize_accepts_large_segments_as_file_part(client, tone_file):
    # ~2.5 MB of segments: more than the 1 MB cap on multipart form *fields*
    segments = [{"start": i, "end": i + 1, "speaker": "SPEAKER_00", "text": "slovo " * 60, "words": None} for i in range(6000)]
    payload = json.dumps(segments).encode()
    assert len(payload) > 2_000_000
    with tone_file.open("rb") as f:
        r = client.post("/diarize", files={"file": ("tone.m4a", f, "audio/mp4"), "segments_file": ("segments.json", payload, "application/json")},
                        data={"language": "cs"})
    assert r.status_code == 202, r.text
    st = wait_done(client, r.json()["task_id"])
    assert st["status"] == "COMPLETED"
    assert len(client.get(f"/tasks/{st['task_id']}/result").json()["segments"]) == 6000


def test_cleanup_removes_stale_incoming_and_expired_tasks(client, tone_file, monkeypatch, tmp_path):
    import os
    import time as _time

    from worker.queue import task_queue

    incoming = settings.data_dir / "incoming"
    incoming.mkdir(parents=True, exist_ok=True)
    stale = incoming / "stale.bin"
    stale.write_bytes(b"x")
    old = _time.time() - 7200
    os.utime(stale, (old, old))
    fresh = incoming / "fresh.bin"
    fresh.write_bytes(b"x")

    with tone_file.open("rb") as f:
        task_id = client.post("/transcribe", files={"file": ("tone.m4a", f, "audio/mp4")}).json()["task_id"]
    st = wait_done(client, task_id)
    assert st["status"] == "COMPLETED"

    monkeypatch.setattr(settings, "task_ttl_hours", 1)
    task = task_queue.get(task_id)
    task.finished_at = "2000-01-01T00:00:00+00:00"
    task_queue.cleanup()
    assert not stale.exists() and fresh.exists()
    assert client.get(f"/tasks/{task_id}/status").status_code == 404
    fresh.unlink()
