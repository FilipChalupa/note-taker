"""Throughput statistics used for ETA estimates.

For every phase we keep an exponential moving average of the *real-time factor*
(seconds of audio processed per wall-clock second). Persisted to <data>/stats.json.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path

from .config import settings

log = logging.getLogger("worker.stats")

# Conservative defaults for an RTX 3080 / large-v3-turbo int8_float16 until real numbers exist
DEFAULT_RTF: dict[str, float] = {
    "CONVERTING": 150.0,
    "TRANSCRIBING": 25.0,
    "DIARIZING": 40.0,
}
EMA_ALPHA = 0.35
MIN_SAMPLE_SEC = 3.0  # ignore tiny files, their timing is dominated by fixed overhead


class Stats:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self.rtf: dict[str, float] = dict(DEFAULT_RTF)
        self.samples: dict[str, int] = {k: 0 for k in DEFAULT_RTF}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self._path.read_text())
            for k, v in data.get("rtf", {}).items():
                if k in self.rtf and isinstance(v, (int, float)) and v > 0:
                    self.rtf[k] = float(v)
            for k, v in data.get("samples", {}).items():
                if k in self.samples and isinstance(v, int):
                    self.samples[k] = v
        except (OSError, ValueError):
            pass

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"rtf": self.rtf, "samples": self.samples}, indent=2))
        except OSError as exc:  # pragma: no cover
            log.warning("Could not persist stats: %s", exc)

    def record(self, phase: str, audio_seconds: float | None, wall_seconds: float) -> None:
        if phase not in self.rtf or not audio_seconds or audio_seconds < MIN_SAMPLE_SEC or wall_seconds <= 0:
            return
        rtf = audio_seconds / wall_seconds
        with self._lock:
            n = self.samples[phase]
            # first real sample replaces the default entirely
            self.rtf[phase] = rtf if n == 0 else (1 - EMA_ALPHA) * self.rtf[phase] + EMA_ALPHA * rtf
            self.samples[phase] = n + 1
            self._save()
        log.info("Stats %s: %.1fx realtime (avg %.1fx, n=%d)", phase, rtf, self.rtf[phase], self.samples[phase])

    def expected_seconds(self, phase: str, audio_seconds: float | None) -> float | None:
        if audio_seconds is None:
            return None
        rtf = self.rtf.get(phase)
        return audio_seconds / rtf if rtf else None


stats = Stats(settings.data_dir / "stats.json")
