from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# Load apps/worker/.env if present (does not override real env vars)
load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


class Settings:
    host: str = os.getenv("WORKER_HOST", "0.0.0.0")
    port: int = _int("WORKER_PORT", 8000)
    api_key: str | None = os.getenv("WORKER_API_KEY") or None

    model_name: str = os.getenv("WHISPER_MODEL", "large-v3")
    compute_type: str = os.getenv("COMPUTE_TYPE", "int8_float16")
    device: str = os.getenv("DEVICE", "cuda")
    batch_size: int = _int("BATCH_SIZE", 8)
    default_language: str | None = os.getenv("DEFAULT_LANGUAGE", "cs") or None

    # Drop repeated / known-hallucinated segments (Whisper artefacts on silence and music)
    hallucination_filter: bool = _bool("HALLUCINATION_FILTER", True)

    hf_token: str | None = os.getenv("HF_TOKEN") or None
    diarization_enabled: bool = _bool("DIARIZATION_ENABLED", True)
    # pyannote pipeline on Hugging Face (gated: accept the model terms with the HF_TOKEN account)
    diarization_model: str = os.getenv("DIARIZATION_MODEL") or "pyannote/speaker-diarization-community-1"

    data_dir: Path = Path(os.getenv("WORKER_DATA_DIR", "./data")).resolve()
    task_ttl_hours: int = _int("TASK_TTL_HOURS", 72)

    # Audio normalization target
    sample_rate: int = 16_000
    audio_codec: str = "mp3"  # "mp3" (small, streamable) or "wav"
    # "dynaudnorm" (cheap, default), "loudnorm" (EBU R128, ~3x slower, single-threaded) or "off"
    loudness: str = (os.getenv("LOUDNESS_NORMALIZATION", "dynaudnorm") or "off").strip().lower()

    @property
    def tasks_dir(self) -> Path:
        return self.data_dir / "tasks"


settings = Settings()
settings.tasks_dir.mkdir(parents=True, exist_ok=True)

# An empty HF_HOME (e.g. "HF_HOME=" in .env) would make huggingface_hub cache models
# relative to the CWD. Treat empty as unset so the default ~/.cache/huggingface applies.
if os.environ.get("HF_HOME", None) == "":
    del os.environ["HF_HOME"]

