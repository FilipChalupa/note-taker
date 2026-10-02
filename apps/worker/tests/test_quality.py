"""Audio quality report: level, noise floor and clipping of the original upload."""
import shutil
import wave

import numpy as np
import pytest

from worker.audio import measure_quality

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")

RATE = 16_000


def write_wav(path, samples):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
    return path


def talk(speech_amp, noise_amp, seconds=20, seed=1):
    """Half-second bursts of a tone (the "speech") separated by half a second of room noise."""
    rng = np.random.default_rng(seed)
    t = np.arange(seconds * RATE) / RATE
    gate = (np.floor(t * 2) % 2 == 0).astype(np.float32)
    return speech_amp * np.sin(2 * np.pi * 220 * t) * gate + noise_amp * rng.standard_normal(t.size)


def test_clean_recording(tmp_path):
    q = measure_quality(write_wav(tmp_path / "clean.wav", talk(0.2, 0.001)))
    assert -19 < q["speech_db"] < -15          # a 0.2 sine has an RMS of -17 dBFS
    assert -62 < q["noise_db"] < -58
    assert q["snr_db"] > 40
    assert q["clipped_share"] == 0
    assert 0.4 < q["speech_share"] < 0.6


def test_noisy_and_quiet_recording(tmp_path):
    q = measure_quality(write_wav(tmp_path / "noisy.wav", talk(0.01, 0.003)))
    assert q["speech_db"] < -40
    assert q["snr_db"] < 15


def test_clipping_is_counted(tmp_path):
    q = measure_quality(write_wav(tmp_path / "clipped.wav", talk(3.0, 0.001)))
    assert q["clipped_share"] > 0.1


def test_muted_stretches_are_not_the_noise_floor(tmp_path):
    samples = talk(0.2, 0.002)
    samples[: 8 * RATE] = 0  # recorder paused or microphone muted: digital silence
    q = measure_quality(write_wav(tmp_path / "muted.wav", samples))
    assert -58 < q["noise_db"] < -50


def test_unmeasurable_input_gives_no_report(tmp_path):
    assert measure_quality(write_wav(tmp_path / "silence.wav", np.zeros(5 * RATE))) is None
    broken = tmp_path / "broken.wav"
    broken.write_bytes(b"not audio")
    assert measure_quality(broken) is None
