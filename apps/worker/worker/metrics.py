"""Processing metrics: totals and per-day buckets, persisted to <data>/metrics.json."""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from .config import settings

log = logging.getLogger("worker.metrics")
KEEP_DAYS = 90


class Metrics:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self.totals = {"completed": 0, "failed": 0, "audio_seconds": 0.0, "processing_seconds": 0.0, "diarize_only": 0}
        self.days: dict[str, dict] = {}
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self._path.read_text())
            self.totals.update({k: v for k, v in data.get("totals", {}).items() if k in self.totals})
            self.days = {k: v for k, v in data.get("days", {}).items() if isinstance(v, dict)}
        except (OSError, ValueError):
            pass

    def _save(self) -> None:
        try:
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._path.write_text(json.dumps({"totals": self.totals, "days": self.days}, indent=2))
        except OSError as exc:  # pragma: no cover
            log.warning("Could not persist metrics: %s", exc)

    def record(self, *, kind: str, audio_seconds: float | None, processing_seconds: float, failed: bool) -> None:
        day = datetime.now(timezone.utc).date().isoformat()
        with self._lock:
            bucket = self.days.setdefault(day, {"completed": 0, "failed": 0, "audio_seconds": 0.0, "processing_seconds": 0.0})
            if failed:
                self.totals["failed"] += 1
                bucket["failed"] += 1
            else:
                self.totals["completed"] += 1
                bucket["completed"] += 1
                if kind == "diarize":
                    self.totals["diarize_only"] += 1
                self.totals["audio_seconds"] += audio_seconds or 0.0
                bucket["audio_seconds"] += audio_seconds or 0.0
            self.totals["processing_seconds"] += processing_seconds
            bucket["processing_seconds"] += processing_seconds
            if len(self.days) > KEEP_DAYS:
                for old in sorted(self.days)[: len(self.days) - KEEP_DAYS]:
                    del self.days[old]
            self._save()

    def snapshot(self) -> dict:
        with self._lock:
            days = [{"date": d, **v} for d, v in sorted(self.days.items())]
            t = dict(self.totals)
        speed = (t["audio_seconds"] / t["processing_seconds"]) if t["processing_seconds"] > 0 else None
        runs = t["completed"] + t["failed"]
        return {
            "totals": t,
            "speed_rtf": None if speed is None else round(speed, 1),
            "failure_rate": (t["failed"] / runs) if runs else 0.0,
            "days": days,
        }


metrics = Metrics(settings.data_dir / "metrics.json")
