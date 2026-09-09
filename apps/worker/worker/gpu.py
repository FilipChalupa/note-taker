"""GPU telemetry via nvidia-smi (works in WSL2 where NVML python bindings are not installed)."""
from __future__ import annotations

import shutil
import subprocess
import threading
import time
from typing import Optional

_CACHE: dict = {"at": 0.0, "value": None}
_LOCK = threading.Lock()
_TTL = 2.0


def query() -> Optional[dict]:
    """Return {utilization_pct, temperature_c, power_w, memory_used_mb, memory_total_mb} or None."""
    now = time.time()
    with _LOCK:
        if now - _CACHE["at"] < _TTL:
            return _CACHE["value"]
        value = _query_uncached()
        _CACHE.update(at=now, value=value)
        return value


def _query_uncached() -> Optional[dict]:
    if shutil.which("nvidia-smi") is None:
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu,power.draw,memory.used,memory.total",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if out.returncode != 0 or not out.stdout.strip():
        return None
    parts = [p.strip() for p in out.stdout.strip().splitlines()[0].split(",")]
    if len(parts) < 5:
        return None

    def num(v: str):
        try:
            return float(v)
        except ValueError:
            return None

    util, temp, power, used, total = (num(p) for p in parts[:5])
    return {
        "utilization_pct": None if util is None else int(util),
        "temperature_c": None if temp is None else int(temp),
        "power_w": None if power is None else round(power, 1),
        "memory_used_mb": None if used is None else int(used),
        "memory_total_mb": None if total is None else int(total),
    }
