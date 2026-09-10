from __future__ import annotations

import json
import logging
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from . import __version__
from . import gpu as gpu_telemetry
from .audio import ensure_ffmpeg
from .config import settings
from .models import (CudaInfo, Health, QueueInfo, TaskResult, TaskStatus,
                     TaskStatusResponse, TranscribeAccepted)
from .metrics import metrics
from .pipeline import pipeline
from .stats import stats
from .queue import PHASE_LABEL, task_queue

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("worker")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_ffmpeg()
    task_queue.start()
    if not settings.hf_token and settings.diarization_enabled:
        log.warning("HF_TOKEN not set - diarization will be skipped")
    yield


app = FastAPI(
    title="note-taker worker",
    version=__version__,
    description="WhisperX + pyannote GPU transcription service",
    lifespan=lifespan,
)


# ------------------------------------------------------------------ auth
def require_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    if settings.api_key and x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


auth = [Depends(require_api_key)]


# ---------------------------------------------------------------- helpers
def _get_task_or_404(task_id: str):
    task = task_queue.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def _status_response(task) -> TaskStatusResponse:
    est = task_queue.estimate(task)
    return TaskStatusResponse(
        task_id=task.id,
        kind=task.kind,
        filename=task.original_filename,
        status=task.status,
        progress=est["progress"],
        phase=PHASE_LABEL[task.status],
        queue_position=task_queue.queue_position(task.id),
        error=task.error,
        duration=task.duration,
        eta_seconds=est["eta_seconds"],
        expected_finish_at=est["expected_finish_at"],
        speed_rtf=est["speed_rtf"],
        created_at=task.created_at,
        started_at=task.started_at,
        finished_at=task.finished_at,
    )


# -------------------------------------------------------------- endpoints
@app.get("/health", response_model=Health)
def health() -> Health:
    cuda = CudaInfo(available=False)
    try:
        import torch

        if torch.cuda.is_available():
            free, total = torch.cuda.mem_get_info()
            cuda = CudaInfo(
                available=True,
                device_name=torch.cuda.get_device_name(0),
                vram_total_mb=total // (1024 * 1024),
                vram_free_mb=free // (1024 * 1024),
                vram_used_mb=(total - free) // (1024 * 1024),
            )
    except Exception as exc:  # noqa: BLE001
        log.debug("CUDA probe failed: %s", exc)
    telemetry = gpu_telemetry.query()
    if telemetry:
        cuda.utilization_pct = telemetry["utilization_pct"]
        cuda.temperature_c = telemetry["temperature_c"]
        cuda.power_w = telemetry["power_w"]
        cuda.memory_used_mb = telemetry["memory_used_mb"]
        if cuda.vram_total_mb is None and telemetry["memory_total_mb"]:
            cuda.vram_total_mb = telemetry["memory_total_mb"]

    return Health(
        ok=True,
        version=__version__,
        model=settings.model_name,
        compute_type=settings.compute_type,
        device=settings.device,
        model_loaded=pipeline.model_loaded,
        diarization_enabled=bool(settings.diarization_enabled and settings.hf_token),
        diarization_error=pipeline.diarization_error or (None if settings.hf_token or not settings.diarization_enabled else "HF_TOKEN is not set"),
        cuda=cuda,
        queue=QueueInfo(pending=task_queue.pending(), current_task_id=task_queue.current_task_id),
    )


@app.post("/transcribe", response_model=TranscribeAccepted, status_code=202, dependencies=auth)
async def transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default=None),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
    initial_prompt: Optional[str] = Form(default=None, description="Glossary / vocabulary hints for Whisper"),
) -> TranscribeAccepted:
    if min_speakers is not None and min_speakers < 1:
        raise HTTPException(400, "min_speakers must be >= 1")
    if max_speakers is not None and max_speakers < 1:
        raise HTTPException(400, "max_speakers must be >= 1")
    if min_speakers and max_speakers and min_speakers > max_speakers:
        raise HTTPException(400, "min_speakers must be <= max_speakers")

    lang = (language or "").strip().lower() or settings.default_language
    if lang in ("auto", "none"):
        lang = None

    suffix = Path(file.filename or "upload").suffix or ".bin"
    tmp_dir = settings.data_dir / "incoming"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=tmp_dir, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp, length=1024 * 1024)
        tmp_path = Path(tmp.name)
    await file.close()

    if tmp_path.stat().st_size == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(400, "Empty file")

    task = task_queue.submit(
        original_filename=file.filename or tmp_path.name,
        input_path=tmp_path,
        language=lang,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        initial_prompt=initial_prompt,
    )
    return TranscribeAccepted(
        task_id=task.id,
        status=task.status,
        queue_position=task_queue.queue_position(task.id) or 0,
    )


@app.post("/diarize", response_model=TranscribeAccepted, status_code=202, dependencies=auth)
async def diarize(
    file: UploadFile = File(...),
    segments: Optional[str] = Form(default=None, description="JSON array of transcript segments (small transcripts)"),
    segments_file: Optional[UploadFile] = File(default=None, description="Same as `segments` but as a file part; use for long transcripts (form fields are capped at 1 MB)"),
    language: Optional[str] = Form(default=None),
    min_speakers: Optional[int] = Form(default=None),
    max_speakers: Optional[int] = Form(default=None),
) -> TranscribeAccepted:
    """Re-run speaker identification only, on an already transcribed recording."""
    if not settings.diarization_enabled or not settings.hf_token:
        raise HTTPException(409, "Diarization is disabled on this worker (HF_TOKEN / DIARIZATION_ENABLED)")
    if min_speakers and max_speakers and min_speakers > max_speakers:
        raise HTTPException(400, "min_speakers must be <= max_speakers")
    raw = segments
    if segments_file is not None:
        raw = (await segments_file.read()).decode("utf-8", errors="replace")
        await segments_file.close()
    if raw is None:
        raise HTTPException(400, "segments (form field) or segments_file (file part) is required")
    try:
        parsed = json.loads(raw)
        assert isinstance(parsed, list)
    except (ValueError, AssertionError):
        raise HTTPException(400, "segments must be a JSON array")

    suffix = Path(file.filename or "audio").suffix or ".bin"
    tmp_dir = settings.data_dir / "incoming"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=tmp_dir, suffix=suffix) as tmp:
        shutil.copyfileobj(file.file, tmp, length=1024 * 1024)
        tmp_path = Path(tmp.name)
    await file.close()
    if tmp_path.stat().st_size == 0:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(400, "Empty file")

    task = task_queue.submit(
        original_filename=file.filename or tmp_path.name,
        input_path=tmp_path,
        language=(language or "").strip().lower() or None,
        min_speakers=min_speakers,
        max_speakers=max_speakers,
        kind="diarize",
        segments=parsed,
    )
    return TranscribeAccepted(task_id=task.id, status=task.status, queue_position=task_queue.queue_position(task.id) or 0)


@app.get("/metrics", dependencies=auth)
def get_metrics() -> dict:
    """Processing totals, per-day buckets and learned phase speeds."""
    snap = metrics.snapshot()
    snap["phase_rtf"] = dict(stats.rtf)
    return snap


@app.get("/tasks", dependencies=auth)
def list_tasks(active_only: bool = False) -> list[TaskStatusResponse]:
    """All known tasks; `active_only=true` returns just the current + queued ones, queue order first."""
    items = [_status_response(t) for t in task_queue.all_tasks()]
    if active_only:
        items = [i for i in items if not i.status.terminal]
    items.sort(key=lambda i: (i.queue_position if i.queue_position is not None else 10**9, i.created_at))
    return items


@app.get("/tasks/{task_id}/status", response_model=TaskStatusResponse, dependencies=auth)
def task_status(task_id: str) -> TaskStatusResponse:
    return _status_response(_get_task_or_404(task_id))


@app.get("/tasks/{task_id}/result", response_model=TaskResult, dependencies=auth)
def task_result(task_id: str):
    task = _get_task_or_404(task_id)
    if task.status == TaskStatus.FAILED:
        raise HTTPException(status_code=409, detail=f"Task failed: {task.error}")
    if task.status != TaskStatus.COMPLETED:
        return JSONResponse(
            status_code=202,
            content={"detail": "Task not finished", **_status_response(task).model_dump()},
        )
    path = task_queue.result_path(task_id)
    if not path.exists():
        raise HTTPException(status_code=500, detail="Result file missing")
    return FileResponse(path, media_type="application/json")


@app.get("/tasks/{task_id}/audio", dependencies=auth)
def task_audio(task_id: str):
    task = _get_task_or_404(task_id)
    if not task.audio_path or not Path(task.audio_path).exists():
        raise HTTPException(status_code=404, detail="Normalized audio not available")
    p = Path(task.audio_path)
    media = "audio/mpeg" if p.suffix == ".mp3" else "audio/wav"
    return FileResponse(p, media_type=media, filename=p.name)


@app.delete("/tasks/{task_id}", status_code=204, dependencies=auth)
def delete_task(task_id: str) -> None:
    task = _get_task_or_404(task_id)
    if task.id == task_queue.current_task_id:
        raise HTTPException(status_code=409, detail="Task is currently processing")
    task_queue.delete(task_id)
