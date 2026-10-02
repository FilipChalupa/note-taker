"""ffmpeg helpers: normalize any input to 16 kHz mono and probe duration."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional

import numpy as np


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


QUALITY_FRAME_SECONDS = 0.05


def measure_quality(src: Path, sample_rate: int = 16_000) -> Optional[dict]:
    """Speech level, noise floor and clipping of the *original* input, before loudness normalization evens them out.

    The file is decoded to raw 16-bit mono and read as a stream in 50 ms frames, so an hours-long recording
    needs no memory. Noise floor = 5th percentile of the frame levels (the gaps between words), speech = the
    frames at least 10 dB above it. Returns None when the file has no measurable audio; never raises: the
    report is an extra, the transcription must not fail because of it.
    """
    frame = int(sample_rate * QUALITY_FRAME_SECONDS)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src), "-vn", "-sn", "-dn",
           "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-"]
    levels: list[np.ndarray] = []
    clipped = 0
    total = 0
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert proc.stdout is not None
        block = frame * 2 * 1200  # one minute of audio per read
        while True:
            raw = proc.stdout.read(block)
            if not raw:
                break
            samples = np.frombuffer(raw[: len(raw) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
            total += samples.size
            clipped += int(np.count_nonzero(np.abs(samples) >= 0.985))
            whole = samples[: samples.size // frame * frame]
            if whole.size:
                levels.append(np.sqrt(np.mean(whole.reshape(-1, frame) ** 2, axis=1)))
        proc.wait(timeout=30)
    except Exception:  # noqa: BLE001
        return None
    if not levels:
        return None
    rms = np.concatenate(levels)
    audible = rms[rms > 1e-5]  # digital silence (a muted stretch, a paused recorder) is not the room's noise
    if audible.size < 20:
        return None
    noise = max(float(np.percentile(audible, 5)), 1e-5)
    speech_frames = audible[audible > noise * 10 ** (10 / 20)]
    if speech_frames.size == 0:
        # speech barely above the noise: exactly the recording the report is for
        speech_frames = audible[audible > noise * 10 ** (6 / 20)]
    if speech_frames.size == 0:
        return None  # an even level throughout (a tone, plain noise): nothing to tell apart
    speech = float(np.sqrt(np.mean(speech_frames ** 2)))
    db = lambda v: round(20 * float(np.log10(max(v, 1e-5))), 1)  # noqa: E731
    return {
        "speech_db": db(speech),
        "noise_db": db(noise),
        "snr_db": round(db(speech) - db(noise), 1),
        "clipped_share": round(clipped / max(total, 1), 5),
        "speech_share": round(float(speech_frames.size) / float(rms.size), 3),
    }
