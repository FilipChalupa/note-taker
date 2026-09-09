"""In-process FIFO GPU queue: one background thread processes tasks sequentially.

Task state is kept in memory and mirrored to `<data>/tasks/<id>/status.json`
and `result.json` so the worker can be restarted without losing finished results.
"""
from __future__ import annotations

import json
import logging
import queue
import shutil
import threading
import time
import traceback
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from . import audio as audio_utils
from .config import settings
from .models import TaskStatus
from .pipeline import pipeline
from .stats import stats

log = logging.getLogger("worker.queue")

PHASE_LABEL = {
    TaskStatus.QUEUED: "Waiting in queue",
    TaskStatus.CONVERTING: "Converting audio (ffmpeg)",
    TaskStatus.TRANSCRIBING: "Transcribing (WhisperX)",
    TaskStatus.DIARIZING: "Identifying speakers (pyannote)",
    TaskStatus.COMPLETED: "Done",
    TaskStatus.FAILED: "Failed",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Task:
    id: str
    original_filename: str
    language: Optional[str]
    min_speakers: Optional[int]
    max_speakers: Optional[int]
    status: TaskStatus = TaskStatus.QUEUED
    progress: int = 0
    error: Optional[str] = None
    created_at: str = field(default_factory=_now)
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    duration: Optional[float] = None
    input_path: Optional[str] = None
    audio_path: Optional[str] = None
    phase_started_at: Optional[str] = None
    phase_seconds: dict = field(default_factory=dict)  # measured wall time per finished phase
    kind: str = "transcribe"  # "transcribe" | "diarize" (speakers only, transcript supplied by client)
    segments_path: Optional[str] = None
    initial_prompt: Optional[str] = None  # glossary / vocabulary hints for Whisper
    phase_fraction: Optional[float] = None  # real progress of the current phase (0-1) when known

    @property
    def dir(self) -> Path:
        return settings.tasks_dir / self.id

    def to_json(self) -> dict:
        d = asdict(self)
        d["status"] = self.status.value
        return d

    @classmethod
    def from_json(cls, d: dict) -> "Task":
        d = dict(d)
        d["status"] = TaskStatus(d["status"])
        return cls(**d)


class TaskQueue:
    def __init__(self) -> None:
        self._tasks: dict[str, Task] = {}
        self._order: list[str] = []  # queued task ids in FIFO order
        self._lock = threading.RLock()
        self._q: "queue.Queue[str]" = queue.Queue()
        self._current: Optional[str] = None
        self._thread: Optional[threading.Thread] = None

    # ------------------------------------------------------------- lifecycle
    def start(self) -> None:
        self._restore_from_disk()
        self._cleanup_expired()
        self._thread = threading.Thread(target=self._loop, name="gpu-worker", daemon=True)
        self._thread.start()

    def _restore_from_disk(self) -> None:
        if not settings.tasks_dir.exists():
            return
        for d in settings.tasks_dir.iterdir():
            status_file = d / "status.json"
            if not status_file.is_file():
                continue
            try:
                task = Task.from_json(json.loads(status_file.read_text()))
            except Exception:  # noqa: BLE001
                continue
            if not task.status.terminal:
                # Worker died mid-task: requeue from the original upload or, after conversion,
                # from the normalized audio (the upload is deleted once converted)
                has_input = bool(task.input_path and Path(task.input_path).exists())
                has_audio = bool(task.audio_path and Path(task.audio_path).exists())
                if has_input or has_audio:
                    task.status = TaskStatus.QUEUED
                    task.progress = 0
                    task.phase_started_at = None
                    task.phase_seconds = {}
                    task.error = None
                    self._tasks[task.id] = task
                    self._order.append(task.id)
                    self._q.put(task.id)
                    log.info("Requeued unfinished task %s (%s)", task.id, "from upload" if has_input else "from normalized audio")
                    continue
                task.status = TaskStatus.FAILED
                task.error = "Worker restarted before task finished"
                task.finished_at = _now()
            self._tasks[task.id] = task
            self._persist(task)
        log.info("Restored %d task(s) from disk", len(self._tasks))

    def _cleanup_expired(self) -> None:
        if settings.task_ttl_hours <= 0:
            return
        cutoff = datetime.now(timezone.utc) - timedelta(hours=settings.task_ttl_hours)
        for task in list(self._tasks.values()):
            if not task.status.terminal:
                continue
            finished = datetime.fromisoformat(task.finished_at or task.created_at)
            if finished < cutoff:
                self.delete(task.id)

    # --------------------------------------------------------------- public
    def submit(self, original_filename: str, input_path: Path, language: Optional[str],
               min_speakers: Optional[int], max_speakers: Optional[int],
               kind: str = "transcribe", segments: Optional[list] = None,
               initial_prompt: Optional[str] = None) -> Task:
        task = Task(
            id=uuid.uuid4().hex,
            original_filename=original_filename,
            language=language,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
            kind=kind,
            initial_prompt=(initial_prompt or "").strip()[:1500] or None,
        )
        task.dir.mkdir(parents=True, exist_ok=True)
        final_input = task.dir / f"input{input_path.suffix.lower() or '.bin'}"
        shutil.move(str(input_path), final_input)
        task.input_path = str(final_input)
        if segments is not None:
            seg_path = task.dir / "segments.json"
            seg_path.write_text(json.dumps(segments, ensure_ascii=False))
            task.segments_path = str(seg_path)
        try:
            task.duration = audio_utils.probe_duration(final_input)
        except audio_utils.AudioError as exc:
            log.warning("Could not probe duration of %s: %s", original_filename, exc)
        with self._lock:
            self._tasks[task.id] = task
            self._order.append(task.id)
            self._persist(task)
        self._q.put(task.id)
        log.info("Queued task %s (%s)", task.id, original_filename)
        return task

    def get(self, task_id: str) -> Optional[Task]:
        with self._lock:
            return self._tasks.get(task_id)

    def queue_position(self, task_id: str) -> Optional[int]:
        with self._lock:
            if self._current == task_id:
                return 0
            if task_id in self._order:
                return self._order.index(task_id) + 1
            return None

    def all_tasks(self) -> list[Task]:
        with self._lock:
            return list(self._tasks.values())

    def pending(self) -> int:
        with self._lock:
            return len(self._order)

    @property
    def current_task_id(self) -> Optional[str]:
        return self._current

    def result_path(self, task_id: str) -> Path:
        return settings.tasks_dir / task_id / "result.json"

    def delete(self, task_id: str) -> bool:
        with self._lock:
            task = self._tasks.pop(task_id, None)
            if task_id in self._order:
                self._order.remove(task_id)
        if task is None:
            return False
        shutil.rmtree(task.dir, ignore_errors=True)
        return True

    # -------------------------------------------------------------- internal
    def _persist(self, task: Task) -> None:
        task.dir.mkdir(parents=True, exist_ok=True)
        (task.dir / "status.json").write_text(json.dumps(task.to_json(), indent=2))

    def _update(self, task: Task, status: TaskStatus, progress: int, fraction: Optional[float] = None) -> None:
        with self._lock:
            if status != task.status:
                task.phase_fraction = None
                now_dt = datetime.now(timezone.utc)
                if task.phase_started_at and not task.status.terminal and task.status != TaskStatus.QUEUED:
                    elapsed = (now_dt - datetime.fromisoformat(task.phase_started_at)).total_seconds()
                    task.phase_seconds[task.status.value] = round(elapsed, 3)
                    if task.status.value in ("CONVERTING", "TRANSCRIBING", "DIARIZING"):
                        stats.record(task.status.value, task.duration, elapsed)
                task.phase_started_at = now_dt.isoformat()
            task.status = status
            task.progress = max(task.progress, progress) if not status.terminal else progress
            if fraction is not None:
                task.phase_fraction = max(task.phase_fraction or 0.0, min(1.0, fraction))
            self._persist(task)

    # ------------------------------------------------------------- estimates
    def _phases(self, task: Optional[Task] = None) -> list[str]:
        if task is not None and task.kind == "diarize":
            return ["CONVERTING", "DIARIZING"]
        phases = ["CONVERTING", "TRANSCRIBING"]
        if settings.diarization_enabled and settings.hf_token:
            phases.append("DIARIZING")
        return phases

    def _expected_total(self, task: Task) -> Optional[float]:
        if task.duration is None:
            return None
        return sum(stats.expected_seconds(p, task.duration) or 0.0 for p in self._phases(task))

    def _remaining_seconds(self, task: Task) -> Optional[float]:
        """Remaining processing time of a running task (None if unknown)."""
        if task.status.terminal:
            return 0.0
        total = self._expected_total(task)
        if total is None:
            return None
        if task.status == TaskStatus.QUEUED:
            return total
        done = 0.0
        for p in self._phases(task):
            exp = stats.expected_seconds(p, task.duration) or 0.0
            if p == task.status.value:
                elapsed = 0.0
                if task.phase_started_at:
                    elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(task.phase_started_at)).total_seconds()
                f = task.phase_fraction
                if f is not None and f >= 0.05:
                    # Real progress known: project this phase's total from elapsed / fraction
                    projected = elapsed / f
                    return max(0.0, (total - done - exp) + (projected - elapsed))
                done += min(elapsed, exp * 0.97)
                break
            done += task.phase_seconds.get(p, exp)
        return max(0.0, total - done)

    def estimate(self, task: Task) -> dict:
        """Smooth progress + ETA for a task, including queue wait for queued tasks."""
        remaining = self._remaining_seconds(task)
        total = self._expected_total(task)
        progress = task.progress
        if task.status.terminal:
            progress = 100 if task.status == TaskStatus.COMPLETED else task.progress
        elif task.phase_fraction is not None:
            progress = task.progress  # driven by real callbacks from the pipeline
        elif task.status != TaskStatus.QUEUED and total and remaining is not None:
            progress = int(round(3 + 95 * (1 - remaining / total)))
            progress = max(task.progress if task.status == TaskStatus.CONVERTING else 3, min(98, progress))

        wait = 0.0
        if task.status == TaskStatus.QUEUED:
            with self._lock:
                ahead = self._order[: self._order.index(task.id)] if task.id in self._order else []
                current = self._tasks.get(self._current) if self._current else None
            if current is not None:
                r = self._remaining_seconds(current)
                wait += r if r is not None else 0.0
            for tid in ahead:
                t = self._tasks.get(tid)
                if t is not None:
                    wait += self._expected_total(t) or 0.0

        eta = None if remaining is None else remaining + wait
        finish_at = None
        if eta is not None and not task.status.terminal:
            finish_at = (datetime.now(timezone.utc) + timedelta(seconds=eta)).isoformat()
        speed = None
        if task.status.value in stats.rtf:
            speed = stats.rtf[task.status.value]
        elif task.status == TaskStatus.QUEUED and task.duration:
            speed = task.duration / total if total else None
        return {
            "progress": progress,
            "eta_seconds": None if eta is None else round(eta),
            "expected_finish_at": finish_at,
            "speed_rtf": None if speed is None else round(speed, 1),
        }

    def _loop(self) -> None:
        log.info("GPU worker thread started")
        while True:
            task_id = self._q.get()
            with self._lock:
                task = self._tasks.get(task_id)
                if task is None:
                    continue
                if task_id in self._order:
                    self._order.remove(task_id)
                self._current = task_id
            try:
                self._process(task)
            except Exception as exc:  # noqa: BLE001
                log.error("Task %s failed: %s\n%s", task.id, exc, traceback.format_exc())
                with self._lock:
                    task.error = f"{type(exc).__name__}: {exc}"[:2000]
                    task.finished_at = _now()
                    self._update(task, TaskStatus.FAILED, task.progress)
            finally:
                with self._lock:
                    self._current = None
                self._q.task_done()

    def _process(self, task: Task) -> None:
        started = time.time()
        task.started_at = _now()
        self._update(task, TaskStatus.CONVERTING, 5)

        ext = "wav" if settings.audio_codec == "wav" else "mp3"
        dst = task.dir / f"audio.{ext}"
        if task.input_path and Path(task.input_path).exists():
            src = Path(task.input_path)
            audio_utils.normalize(src, dst, settings.sample_rate, settings.audio_codec, settings.loudness)
            task.audio_path = str(dst)
            task.duration = audio_utils.probe_duration(dst)
            self._update(task, TaskStatus.CONVERTING, 15)
            # Remove original upload to save disk; normalized copy is kept
            try:
                src.unlink()
                task.input_path = None
            except OSError:
                pass
        elif task.audio_path and Path(task.audio_path).exists():
            # Restored after a restart: conversion already happened
            dst = Path(task.audio_path)
            if task.duration is None:
                task.duration = audio_utils.probe_duration(dst)
            self._update(task, TaskStatus.CONVERTING, 15)
        else:
            raise RuntimeError("Input file is missing (worker restarted before conversion finished)")

        def progress(status: str, pct: int, fraction: Optional[float] = None) -> None:
            self._update(task, TaskStatus(status), pct, fraction)

        if task.kind == "diarize":
            segments = json.loads(Path(task.segments_path).read_text())  # type: ignore[arg-type]
            out = pipeline.diarize_only(dst, segments, task.min_speakers, task.max_speakers, progress)
            out["language"] = task.language or "unknown"
        else:
            out = pipeline.run(dst, task.language, task.min_speakers, task.max_speakers, progress,
                               initial_prompt=task.initial_prompt)

        result = {
            "task_id": task.id,
            "kind": task.kind,
            "language": out["language"],
            "duration": task.duration,
            "model": settings.model_name,
            "diarized": out["diarized"],
            "diarization_error": out.get("diarization_error"),
            "speakers": out["speakers"],
            "segments": out["segments"],
            "audio_url": f"/tasks/{task.id}/audio",
            "audio_mime": "audio/mpeg" if ext == "mp3" else "audio/wav",
        }
        self.result_path(task.id).write_text(json.dumps(result, ensure_ascii=False))
        task.finished_at = _now()
        self._update(task, TaskStatus.COMPLETED, 100)
        log.info("Task %s completed in %.1fs (%d segments, %d speakers)",
                 task.id, time.time() - started, len(out["segments"]), len(out["speakers"]))


task_queue = TaskQueue()
