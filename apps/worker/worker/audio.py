"""ffmpeg helpers: normalize any input to 16 kHz mono, probe duration and audio streams, measure levels."""
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


def probe_audio_streams(path: Path) -> list[dict]:
    """Audio streams of a container, in order: [{index, channels, codec, title}]. `index` counts audio streams
    only (ffmpeg's `0:a:N`), so it stays valid when the file also has video. Empty list when probing fails."""
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=channels,codec_name:stream_tags=title,handler_name",
        "-of", "json", str(path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        return []
    try:
        streams = json.loads(proc.stdout).get("streams") or []
    except json.JSONDecodeError:
        return []
    out = []
    for i, st in enumerate(streams):
        tags = st.get("tags") or {}
        title = (tags.get("title") or "").strip() or None
        out.append({"index": i, "channels": st.get("channels"), "codec": st.get("codec_name"), "title": title})
    return out


LOUDNESS_FILTERS = {
    "loudnorm": "loudnorm=I=-16:TP=-1.5:LRA=11",   # EBU R128, accurate but slow (single thread)
    "dynaudnorm": "dynaudnorm=f=250:g=15",         # fast streaming normalizer
    "off": None,
}


def normalize(src: Path, dst: Path, sample_rate: int = 16_000, codec: str = "mp3", loudness: str = "dynaudnorm",
              streams: Optional[list[int]] = None) -> Path:
    """Convert *src* (any container: m4a, ogg, wav, aac, mp4, mkv...) to mono 16 kHz.

    codec="mp3" -> libmp3lame 64 kbps (small, browser friendly)
    codec="wav" -> pcm_s16le
    streams=None takes ffmpeg's default audio stream; [N] takes audio stream N only; several indexes are
    mixed into one (each stream at its own level, so a quiet microphone is not drowned further).
    Audio decoding/filtering in ffmpeg is single-threaded, so this phase uses ~1 CPU core and no GPU.
    """
    dst.parent.mkdir(parents=True, exist_ok=True)
    common = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    af = LOUDNESS_FILTERS.get(loudness, LOUDNESS_FILTERS["dynaudnorm"])
    if streams and len(streams) > 1:
        inputs = "".join(f"[0:a:{i}]" for i in streams)
        graph = f"{inputs}amix=inputs={len(streams)}:normalize=0" + (f",{af}" if af else "") + "[out]"
        common += ["-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", str(sample_rate)]
    else:
        if streams:
            common += ["-map", f"0:a:{streams[0]}"]
        common += [
            "-vn", "-sn", "-dn",          # drop video / subtitles / data streams
            "-ac", "1",                  # mono
            "-ar", str(sample_rate),     # 16 kHz
        ]
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


def _decode_levels(src: Path, sample_rate: int, stream: Optional[int], frame_seconds: float) -> Optional[tuple[np.ndarray, int, int]]:
    """Per-frame RMS of the decoded mono signal plus (clipped samples, total samples); None on failure.

    The file is decoded to raw 16-bit mono and read as a stream, so an hours-long recording needs no memory.
    """
    frame = int(sample_rate * frame_seconds)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(src)]
    if stream is not None:
        cmd += ["-map", f"0:a:{stream}"]
    cmd += ["-vn", "-sn", "-dn", "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "-"]
    levels: list[np.ndarray] = []
    clipped = 0
    total = 0
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert proc.stdout is not None
        block = frame * 2 * 1200  # 1200 frames per read
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
    return np.concatenate(levels), clipped, total


def measure_quality(src: Path, sample_rate: int = 16_000, stream: Optional[int] = None) -> Optional[dict]:
    """Speech level, noise floor and clipping of the *original* input, before loudness normalization evens them out.

    Noise floor = 5th percentile of the 50 ms frame levels (the gaps between words), speech = the frames at
    least 10 dB above it. Returns None when the file has no measurable audio; never raises: the report is an
    extra, the transcription must not fail because of it. `stream` measures one audio stream of a multi-track file.
    """
    decoded = _decode_levels(src, sample_rate, stream, QUALITY_FRAME_SECONDS)
    return None if decoded is None else quality_from_levels(*decoded)


def stream_levels(src: Path, stream: int, sample_rate: int = 16_000) -> tuple[Optional[np.ndarray], Optional[dict]]:
    """Frame levels and quality report of one audio stream from a single decode."""
    decoded = _decode_levels(src, sample_rate, stream, QUALITY_FRAME_SECONDS)
    if decoded is None:
        return None, None
    return decoded[0], quality_from_levels(*decoded)


def quality_from_levels(rms: np.ndarray, clipped: int, total: int) -> Optional[dict]:
    """The report of `measure_quality` from already decoded 50 ms frame levels."""
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
