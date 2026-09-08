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
                # Worker died mid-task: requeue if input still exists, else fail
                if task.input_path and Path(task.input_path).exists():
                    task.status = TaskStatus.QUEUED
                    task.progress = 0
                    self._tasks[task.id] = task
                    self._order.append(task.id)
                    self._q.put(task.id)
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
               min_speakers: Optional[int], max_speakers: Optional[int]) -> Task:
        task = Task(
            id=uuid.uuid4().hex,
            original_filename=original_filename,
            language=language,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )
        task.dir.mkdir(parents=True, exist_ok=True)
        final_input = task.dir / f"input{input_path.suffix.lower() or '.bin'}"
        shutil.move(str(input_path), final_input)
        task.input_path = str(final_input)
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

    def _update(self, task: Task, status: TaskStatus, progress: int) -> None:
        with self._lock:
            task.status = status
            task.progress = max(task.progress, progress) if not status.terminal else progress
            self._persist(task)

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

        src = Path(task.input_path)  # type: ignore[arg-type]
        ext = "wav" if settings.audio_codec == "wav" else "mp3"
        dst = task.dir / f"audio.{ext}"
        audio_utils.normalize(src, dst, settings.sample_rate, settings.audio_codec)
        task.audio_path = str(dst)
        task.duration = audio_utils.probe_duration(dst)
        self._update(task, TaskStatus.CONVERTING, 15)

        # Remove original upload to save disk; normalized copy is kept
        try:
            src.unlink()
            task.input_path = None
        except OSError:
            pass

        def progress(status: str, pct: int) -> None:
            self._update(task, TaskStatus(status), pct)

        out = pipeline.run(dst, task.language, task.min_speakers, task.max_speakers, progress)

        result = {
            "task_id": task.id,
            "language": out["language"],
            "duration": task.duration,
            "model": settings.model_name,
            "diarized": out["diarized"],
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
