"""Pydantic schemas. Keep in sync with packages/shared/src/index.ts."""
from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    QUEUED = "QUEUED"
    CONVERTING = "CONVERTING"
    TRANSCRIBING = "TRANSCRIBING"
    DIARIZING = "DIARIZING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

    @property
    def terminal(self) -> bool:
        return self in (TaskStatus.COMPLETED, TaskStatus.FAILED)


class TranscribeAccepted(BaseModel):
    task_id: str
    status: TaskStatus
    queue_position: int


class TaskStatusResponse(BaseModel):
    task_id: str
    filename: Optional[str] = None
    status: TaskStatus
    progress: int = Field(ge=0, le=100)
    phase: str
    queue_position: Optional[int] = None
    error: Optional[str] = None
    # Audio length in seconds (known right after upload via ffprobe)
    duration: Optional[float] = None
    # Estimated remaining seconds until COMPLETED (includes queue wait for queued tasks)
    eta_seconds: Optional[int] = None
    expected_finish_at: Optional[str] = None
    # Expected processing speed of the current phase, as multiple of real time
    speed_rtf: Optional[float] = None
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class Word(BaseModel):
    word: str
    start: Optional[float] = None
    end: Optional[float] = None
    speaker: Optional[str] = None
    score: Optional[float] = None


class Segment(BaseModel):
    start: float
    end: float
    speaker: str
    text: str
    words: Optional[list[Word]] = None


class TaskResult(BaseModel):
    task_id: str
    language: str
    duration: float
    model: str
    diarized: bool
    speakers: list[str]
    segments: list[Segment]
    audio_url: str
    audio_mime: str


class CudaInfo(BaseModel):
    available: bool
    device_name: Optional[str] = None
    vram_total_mb: Optional[int] = None
    vram_free_mb: Optional[int] = None
    vram_used_mb: Optional[int] = None


class QueueInfo(BaseModel):
    pending: int
    current_task_id: Optional[str] = None


class Health(BaseModel):
    ok: bool
    version: str
    model: str
    compute_type: str
    device: str
    model_loaded: bool
    diarization_enabled: bool
    cuda: CudaInfo
    queue: QueueInfo
