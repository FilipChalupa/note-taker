"""WhisperX transcription + alignment + pyannote diarization.

Models are loaded lazily on first use and kept resident in VRAM between tasks.
Only one task runs at a time (see queue.py), so there is no locking here.
"""
from __future__ import annotations

import gc
import logging
from pathlib import Path
from typing import Callable, Optional

from .config import settings

log = logging.getLogger("worker.pipeline")

ProgressCb = Callable[[str, int], None]  # (status, progress 0-100)


class Pipeline:
    def __init__(self) -> None:
        self._asr = None
        self._align_cache: dict[str, tuple[object, dict]] = {}
        self._diarizer = None

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

            log.info("Loading pyannote diarization pipeline")
            self._diarizer = DiarizationPipeline(
                use_auth_token=settings.hf_token, device=settings.device
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
    ) -> dict:
        import whisperx

        progress("TRANSCRIBING", 20)
        asr = self.load_asr()
        audio = whisperx.load_audio(str(audio_path))

        result = asr.transcribe(
            audio,
            batch_size=settings.batch_size,
            language=language or None,
        )
        detected_language: str = result.get("language") or language or "unknown"
        log.info("Transcribed %s, language=%s, segments=%d",
                 audio_path.name, detected_language, len(result.get("segments", [])))
        progress("TRANSCRIBING", 55)

        # Word-level alignment (skipped if no alignment model exists for the language)
        try:
            model_a, metadata = self._load_align(detected_language)
            result = whisperx.align(
                result["segments"], model_a, metadata, audio, settings.device,
                return_char_alignments=False,
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Alignment skipped (%s): %s", detected_language, exc)
        progress("TRANSCRIBING", 70)

        diarized = False
        if settings.diarization_enabled and settings.hf_token:
            progress("DIARIZING", 75)
            try:
                diarizer = self._load_diarizer()
                kwargs = {}
                if min_speakers:
                    kwargs["min_speakers"] = min_speakers
                if max_speakers:
                    kwargs["max_speakers"] = max_speakers
                diarize_segments = diarizer(audio, **kwargs)
                result = whisperx.assign_word_speakers(diarize_segments, result)
                diarized = True
            except Exception as exc:  # noqa: BLE001
                log.exception("Diarization failed, continuing without speakers: %s", exc)
        elif settings.diarization_enabled and not settings.hf_token:
            log.warning("DIARIZATION_ENABLED but HF_TOKEN missing - skipping diarization")
        progress("DIARIZING", 95)

        segments = _postprocess_segments(result.get("segments", []), diarized)
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
            "speakers": speakers,
            "segments": segments,
        }


# --------------------------------------------------------------------- utils
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
