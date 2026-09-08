"""ffmpeg helpers: normalize any input to 16 kHz mono and probe duration."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


class AudioError(RuntimeError):
    pass


def ensure_ffmpeg() -> None:
    for binary in ("ffmpeg", "ffprobe"):
        if shutil.which(binary) is None:
            raise AudioError(f"'{binary}' not found in PATH. Install ffmpeg (apt install ffmpeg).")


def probe_duration(path: Path) -> float:
    cmd = [
        "ffprobe", "-v", "error",
        "-show_entries", "format=duration",
        "-of", "json", str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise AudioError(f"ffprobe failed: {proc.stderr.strip()[:500]}")
    try:
        return float(json.loads(proc.stdout)["format"]["duration"])
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise AudioError(f"Could not read duration: {exc}") from exc


LOUDNESS_FILTERS = {
    "loudnorm": "loudnorm=I=-16:TP=-1.5:LRA=11",   # EBU R128, accurate but slow (single thread)
    "dynaudnorm": "dynaudnorm=f=250:g=15",         # fast streaming normalizer
    "off": None,
}


def normalize(src: Path, dst: Path, sample_rate: int = 16_000, codec: str = "mp3", loudness: str = "dynaudnorm") -> Path:
    """Convert *src* (any container: m4a, ogg, wav, aac, mp4, mkv...) to mono 16 kHz.

    codec="mp3" -> libmp3lame 64 kbps (small, browser friendly)
    codec="wav" -> pcm_s16le
    Audio decoding/filtering in ffmpeg is single-threaded, so this phase uses ~1 CPU core and no GPU.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    common = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", str(src),
        "-vn", "-sn", "-dn",          # drop video / subtitles / data streams
        "-ac", "1",                  # mono
        "-ar", str(sample_rate),     # 16 kHz
    ]
    af = LOUDNESS_FILTERS.get(loudness, LOUDNESS_FILTERS["dynaudnorm"])
    if af:
        common += ["-af", af]
    if codec == "wav":
        cmd = common + ["-c:a", "pcm_s16le", str(dst)]
    else:
        cmd = common + ["-c:a", "libmp3lame", "-b:a", "64k", str(dst)]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0 or not dst.exists():
        raise AudioError(f"ffmpeg conversion failed: {proc.stderr.strip()[:1000]}")
    return dst
