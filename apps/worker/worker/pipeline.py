"""WhisperX transcription + alignment + pyannote diarization.

Models are loaded lazily on first use and kept resident in VRAM between tasks.
Only one task runs at a time (see queue.py), so there is no locking here.
"""
from __future__ import annotations

import gc
import logging
import re
from pathlib import Path
from typing import Callable, Optional

from .config import settings

log = logging.getLogger("worker.pipeline")

# (status, progress 0-100, fraction of the current phase 0-1 or None)
ProgressCb = Callable[[str, int, Optional[float]], None]

# Progress bands per phase (percent of the whole task)
BAND = {"CONVERTING": (0, 10), "TRANSCRIBING": (10, 72), "DIARIZING": (72, 98)}


def _band_pct(phase: str, fraction: float) -> int:
    lo, hi = BAND[phase]
    return int(round(lo + (hi - lo) * max(0.0, min(1.0, fraction))))

FALLBACK_DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"
_plda_patched = False


def _short_error(exc: BaseException) -> str:
    """First meaningful line of an exception message (HF errors are very verbose)."""
    text = str(exc).strip()
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for ln in lines:
        if "Cannot access gated repo" in ln or "restricted" in ln:
            return f"{type(exc).__name__}: {ln}"
    return f"{type(exc).__name__}: {lines[0] if lines else ''}"[:300]


def _patch_pyannote_plda() -> None:
    """pyannote.audio >= 4 always downloads a PLDA from the gated `community-1` repo, even for
    pipelines (like speaker-diarization-3.1) whose clustering never uses it. Skip it there."""
    global _plda_patched
    if _plda_patched:
        return
    _plda_patched = True
    try:
        from pyannote.audio.pipelines import speaker_diarization as sd
    except Exception:  # pragma: no cover
        return
    if not hasattr(sd, "get_plda"):
        return
    original_init = sd.SpeakerDiarization.__init__
    original_get_plda = sd.get_plda

    def patched_init(self, *args, **kwargs):
        if kwargs.get("clustering", "VBxClustering") != "VBxClustering":
            sd.get_plda = lambda *a, **k: None  # type: ignore[assignment]
            try:
                return original_init(self, *args, **kwargs)
            finally:
                sd.get_plda = original_get_plda
        return original_init(self, *args, **kwargs)

    sd.SpeakerDiarization.__init__ = patched_init  # type: ignore[method-assign]


class Pipeline:
    def __init__(self) -> None:
        self._asr = None
        self._align_cache: dict[str, tuple[object, dict]] = {}
        self._diarizer = None
        self.diarization_model_loaded: Optional[str] = None
        # Last reason diarization could not run (surfaced via /health and task results)
        self.diarization_error: Optional[str] = None

    # ---------------------------------------------------------------- loading
    @property
    def model_loaded(self) -> bool:
        return self._asr is not None

    def load_asr(self):
        if self._asr is None:
            import whisperx

            log.info(
                "Loading whisper model=%s device=%s compute_type=%s",
                settings.model_name, settings.device, settings.compute_type,
            )
            self._asr = whisperx.load_model(
                settings.model_name,
                settings.device,
                compute_type=settings.compute_type,
                # language=None -> auto-detect per file; we pass it at transcribe time
            )
        return self._asr

    def _load_align(self, language: str):
        if language not in self._align_cache:
            import whisperx

            log.info("Loading alignment model for language=%s", language)
            model_a, metadata = whisperx.load_align_model(
                language_code=language, device=settings.device
            )
            # keep only one alignment model resident to save VRAM
            self._align_cache.clear()
            self._align_cache[language] = (model_a, metadata)
        return self._align_cache[language]

    def _load_diarizer(self):
        if self._diarizer is None:
            try:
                from whisperx.diarize import DiarizationPipeline  # whisperx >= 3.3
            except ImportError:  # pragma: no cover - older whisperx
                from whisperx import DiarizationPipeline  # type: ignore

            _patch_pyannote_plda()
            candidates = [settings.diarization_model]
            if settings.diarization_model != FALLBACK_DIARIZATION_MODEL:
                candidates.append(FALLBACK_DIARIZATION_MODEL)
            errors: list[str] = []
            for model in candidates:
                log.info("Loading pyannote diarization pipeline %s", model)
                try:
                    try:
                        # whisperx >= 3.4 uses `token=`; older releases used `use_auth_token=`
                        self._diarizer = DiarizationPipeline(model_name=model, token=settings.hf_token, device=settings.device)
                    except TypeError:
                        self._diarizer = DiarizationPipeline(
                            model_name=model, use_auth_token=settings.hf_token, device=settings.device
                        )
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{model}: {_short_error(exc)}")
                    log.warning("Diarization model %s unavailable: %s", model, _short_error(exc))
                    continue
                if model != settings.diarization_model:
                    log.warning("Using fallback diarization model %s", model)
                self.diarization_model_loaded = model
                break
            if self._diarizer is None:
                raise RuntimeError(
                    "No diarization model could be loaded (" + " | ".join(errors) + "). "
                    "Accept the model terms with the HF_TOKEN account: "
                    "https://hf.co/pyannote/speaker-diarization-community-1 or "
                    "https://hf.co/pyannote/speaker-diarization-3.1 + https://hf.co/pyannote/segmentation-3.0"
                )
        return self._diarizer

    def unload_all(self) -> None:
        self._asr = None
        self._align_cache.clear()
        self._diarizer = None
        gc.collect()
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # pragma: no cover
            pass

    # ---------------------------------------------------------------- running
    def run(
        self,
        audio_path: Path,
        language: Optional[str],
        min_speakers: Optional[int],
        max_speakers: Optional[int],
        progress: ProgressCb,
        initial_prompt: Optional[str] = None,
    ) -> dict:
        import whisperx

        progress("TRANSCRIBING", _band_pct("TRANSCRIBING", 0.0), 0.0)
        asr = self.load_asr()
        audio = whisperx.load_audio(str(audio_path))

        # Real progress: whisperx reports the fraction of VAD chunks transcribed so far.
        # Transcription is ~85 % of this phase, alignment the rest.
        def on_asr_progress(pct: float) -> None:
            progress("TRANSCRIBING", _band_pct("TRANSCRIBING", 0.85 * pct / 100), 0.85 * pct / 100)

        with _asr_prompt(asr, initial_prompt):
            try:
                result = asr.transcribe(
                    audio,
                    batch_size=settings.batch_size,
                    language=language or None,
                    progress_callback=on_asr_progress,
                )
            except TypeError:  # older whisperx without progress_callback
                result = asr.transcribe(audio, batch_size=settings.batch_size, language=language or None)
        detected_language: str = result.get("language") or language or "unknown"
        log.info("Transcribed %s, language=%s, segments=%d",
                 audio_path.name, detected_language, len(result.get("segments", [])))
        progress("TRANSCRIBING", _band_pct("TRANSCRIBING", 0.85), 0.85)

        # Word-level alignment (skipped if no alignment model exists for the language)
        try:
            model_a, metadata = self._load_align(detected_language)
            result = whisperx.align(
                result["segments"], model_a, metadata, audio, settings.device,
                return_char_alignments=False,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Alignment skipped (%s): %s", detected_language, exc)
        progress("TRANSCRIBING", _band_pct("TRANSCRIBING", 1.0), 1.0)

        diarized = False
        diarization_error: Optional[str] = None
        if settings.diarization_enabled and settings.hf_token:
            progress("DIARIZING", _band_pct("DIARIZING", 0.0), 0.0)
            try:
                diarizer = self._load_diarizer()
                kwargs = {}
                if min_speakers:
                    kwargs["min_speakers"] = min_speakers
                if max_speakers:
                    kwargs["max_speakers"] = max_speakers
                diarize_segments = _run_diarizer(
                    diarizer, audio, kwargs,
                    lambda f: progress("DIARIZING", _band_pct("DIARIZING", f), f),
                )
                result = whisperx.assign_word_speakers(diarize_segments, result)
                diarized = True
                self.diarization_error = None
            except Exception as exc:  # noqa: BLE001
                diarization_error = _short_error(exc) if not isinstance(exc, RuntimeError) else str(exc)[:600]
                self.diarization_error = diarization_error
                self._diarizer = None  # retry loading next time
                log.exception("Diarization failed, continuing without speakers: %s", exc)
        elif settings.diarization_enabled and not settings.hf_token:
            diarization_error = "HF_TOKEN is not set"
            self.diarization_error = diarization_error
            log.warning("DIARIZATION_ENABLED but HF_TOKEN missing - skipping diarization")
        else:
            diarization_error = "Diarization disabled (DIARIZATION_ENABLED=0)"
        progress("DIARIZING", _band_pct("DIARIZING", 1.0), 1.0)

        segments = _postprocess_segments(result.get("segments", []), diarized)
        if settings.hallucination_filter:
            segments = _filter_hallucinations(segments)
        speakers = _ordered_speakers(segments)

        # Free per-file tensors (models stay resident)
        del audio
        gc.collect()
        try:
            import torch

            torch.cuda.empty_cache()
        except Exception:  # pragma: no cover
            pass

        return {
            "language": detected_language,
            "diarized": diarized,
            "diarization_error": diarization_error,
            "speakers": speakers,
            "segments": segments,
        }


    def diarize_only(
        self,
        audio_path: Path,
        segments: list[dict],
        min_speakers: Optional[int],
        max_speakers: Optional[int],
        progress: ProgressCb,
    ) -> dict:
        """Re-run speaker identification on an existing transcript (segments with word timestamps)."""
        import whisperx

        if not settings.diarization_enabled or not settings.hf_token:
            raise RuntimeError("Diarization is disabled or HF_TOKEN is not set")
        progress("DIARIZING", 10, 0.0)
        audio = whisperx.load_audio(str(audio_path))
        diarizer = self._load_diarizer()
        kwargs = {}
        if min_speakers:
            kwargs["min_speakers"] = min_speakers
        if max_speakers:
            kwargs["max_speakers"] = max_speakers
        diarize_segments = _run_diarizer(
            diarizer, audio, kwargs, lambda f: progress("DIARIZING", int(10 + 85 * f), f)
        )
        progress("DIARIZING", 95, 1.0)
        # strip previous speaker labels so assignment starts clean
        clean = []
        for seg in segments:
            seg = dict(seg)
            seg.pop("speaker", None)
            seg["words"] = [{k: v for k, v in w.items() if k != "speaker"} for w in (seg.get("words") or [])]
            clean.append(seg)
        result = whisperx.assign_word_speakers(diarize_segments, {"segments": clean})
        self.diarization_error = None
        out = _postprocess_segments(result.get("segments", []), True)
        del audio
        gc.collect()
        return {"diarized": True, "diarization_error": None, "speakers": _ordered_speakers(out), "segments": out}


# --------------------------------------------------------------------- utils
class _asr_prompt:
    """Temporarily set Whisper's initial_prompt (glossary of names / terms) on the loaded model."""

    def __init__(self, asr, prompt: Optional[str]) -> None:
        self.asr = asr
        self.prompt = (prompt or "").strip() or None
        self._saved = None

    def __enter__(self):
        if self.prompt is None or not hasattr(self.asr, "options"):
            return self
        try:
            from dataclasses import replace

            self._saved = self.asr.options
            self.asr.options = replace(self.asr.options, initial_prompt=self.prompt)
            log.info("Using initial_prompt (%d chars)", len(self.prompt))
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not apply initial_prompt: %s", exc)
            self._saved = None
        return self

    def __exit__(self, *exc_info):
        if self._saved is not None:
            self.asr.options = self._saved
        return False


def _run_diarizer(diarizer, audio, kwargs: dict, on_fraction: Callable[[float], None]):
    """Call the pyannote pipeline with real progress when the installed whisperx supports it."""
    try:
        return diarizer(audio, progress_callback=lambda pct: on_fraction(pct / 100), **kwargs)
    except TypeError:
        return diarizer(audio, **kwargs)


# Phrases Whisper produces on silence / music instead of speech (normalized, lowercase)
HALLUCINATED_PHRASES = {
    "titulky vytvořil johnyx", "titulky vytvořil johny x", "překlad a titulky", "děkuji za pozornost",
    "děkujeme za zhlédnutí", "titulky", "subtitles by the amara.org community", "thank you for watching",
    "thanks for watching", "subtitles by", "like and subscribe", "please subscribe", "www.mooji.org",
}


def _norm_text(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower()).strip()


def _filter_hallucinations(segments: list[dict]) -> list[dict]:
    """Drop typical Whisper artefacts:
    - known credit-like phrases,
    - the same short phrase repeated 3+ times in a row (keep the first occurrence),
    - segments with an impossible speaking rate (many words in a fraction of a second).
    """
    out: list[dict] = []
    run_text, run_len = "", 0
    dropped = 0
    for seg in segments:
        norm = _norm_text(seg["text"])
        words = len(norm.split())
        dur = max(0.0, seg["end"] - seg["start"])
        if norm in HALLUCINATED_PHRASES:
            dropped += 1
            continue
        if words >= 6 and dur > 0 and words / dur > 8.0:
            dropped += 1
            continue
        if norm == run_text and words <= 4:
            run_len += 1
            if run_len >= 3:
                # third and later identical repeats are noise; also retro-drop the second one
                if run_len == 3 and out and _norm_text(out[-1]["text"]) == norm:
                    out.pop()
                    dropped += 1
                dropped += 1
                continue
        else:
            run_text, run_len = norm, 1
        out.append(seg)
    if dropped:
        log.info("Hallucination filter dropped %d segment(s)", dropped)
    return out


def _postprocess_segments(raw: list[dict], diarized: bool) -> list[dict]:
    out: list[dict] = []
    for seg in raw:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        words_raw = seg.get("words") or []
        words = [
            {
                "word": w.get("word", ""),
                "start": w.get("start"),
                "end": w.get("end"),
                "speaker": w.get("speaker"),
                "score": w.get("score"),
            }
            for w in words_raw
        ]
        speaker = seg.get("speaker")
        if not speaker:
            # fall back to majority speaker among words, else SPEAKER_00 / UNKNOWN
            counts: dict[str, int] = {}
            for w in words:
                if w["speaker"]:
                    counts[w["speaker"]] = counts.get(w["speaker"], 0) + 1
            if counts:
                speaker = max(counts, key=counts.get)  # type: ignore[arg-type]
            else:
                speaker = "UNKNOWN" if diarized else "SPEAKER_00"
        out.append(
            {
                "start": float(seg.get("start", 0.0)),
                "end": float(seg.get("end", seg.get("start", 0.0))),
                "speaker": speaker,
                "text": text,
                "words": words or None,
            }
        )
    return out


def _ordered_speakers(segments: list[dict]) -> list[str]:
    seen: list[str] = []
    for seg in segments:
        if seg["speaker"] not in seen:
            seen.append(seg["speaker"])
    # Put UNKNOWN last, keep SPEAKER_xx sorted by first appearance
    return [s for s in seen if s != "UNKNOWN"] + (["UNKNOWN"] if "UNKNOWN" in seen else [])


pipeline = Pipeline()
