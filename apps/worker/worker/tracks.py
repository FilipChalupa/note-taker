"""Multi-track recordings: OBS and similar recorders keep each source (microphone, desktop audio, a mix of
both) as its own audio stream. Transcribing every source separately keeps overlapping speech apart and lets
a quiet microphone be normalized on its own instead of drowning in the mix.

Pure functions over frame levels and pipeline results; the ffmpeg / model work happens in audio.py and
pipeline.py.
"""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from typing import Optional

import numpy as np

from .audio import QUALITY_FRAME_SECONDS

# A track is silent when less than this share of its frames rises clearly above its own noise floor
SILENT_SHARE = 0.005
# Level envelopes this similar mean the same signal (a mix of the other tracks, or a copy of one)
SAME_SIGNAL_CORRELATION = 0.95
# Bleed: the same words in two tracks at the same time (a microphone picking up the loudspeaker)
BLEED_TEXT_SIMILARITY = 0.6
BLEED_MIN_OVERLAP = 0.5

ROLES = ("speech", "mix", "duplicate", "silent")


@dataclass
class TrackSpec:
    """What the client asked for one audio stream. `index` counts audio streams only (ffmpeg `0:a:N`)."""
    index: int
    name: Optional[str] = None
    use: bool = True
    min_speakers: Optional[int] = None
    max_speakers: Optional[int] = None

    def to_json(self) -> dict:
        return asdict(self)


def parse_track_specs(raw: object) -> list[TrackSpec]:
    """Validate the `tracks` request field (a JSON array). Raises ValueError with a readable message."""
    if not isinstance(raw, list) or not raw:
        raise ValueError("tracks must be a non-empty JSON array")
    specs: list[TrackSpec] = []
    seen: set[int] = set()
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("every track must be an object")
        index = item.get("index")
        if not isinstance(index, int) or isinstance(index, bool) or index < 0:
            raise ValueError("track index must be an integer >= 0")
        if index in seen:
            raise ValueError(f"track {index} is listed twice")
        seen.add(index)
        name = item.get("name")
        if name is not None and not isinstance(name, str):
            raise ValueError("track name must be a string")
        name = (name or "").strip()[:60] or None
        lo, hi = item.get("min_speakers"), item.get("max_speakers")
        for v in (lo, hi):
            if v is not None and (not isinstance(v, int) or isinstance(v, bool) or v < 1):
                raise ValueError("track min_speakers / max_speakers must be integers >= 1")
        if lo and hi and lo > hi:
            raise ValueError("track min_speakers must be <= max_speakers")
        specs.append(TrackSpec(index=index, name=name, use=bool(item.get("use", True)), min_speakers=lo, max_speakers=hi))
    if not any(s.use for s in specs):
        raise ValueError("at least one track must be used")
    return sorted(specs, key=lambda s: s.index)


# ------------------------------------------------------------------ classification
def _db(levels: np.ndarray) -> np.ndarray:
    return 20 * np.log10(np.maximum(levels, 1e-5))


def active_share(levels: Optional[np.ndarray]) -> float:
    """Share of frames clearly above the track's own noise floor (and above -60 dBFS)."""
    if levels is None or levels.size == 0:
        return 0.0
    db = _db(levels)
    threshold = max(float(np.percentile(db, 5)) + 15.0, -60.0)
    return float(np.mean(db > threshold))


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    if a.std() == 0 or b.std() == 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def classify_tracks(levels: list[Optional[np.ndarray]]) -> list[str]:
    """Role of every stream: "speech" (transcribe it), "mix" (sum of other tracks), "duplicate" (copy of
    another track) or "silent".

    The mix is found by its level envelope matching the combined envelope of the other tracks. When two
    tracks both match (a mix whose quiet second source barely changes it), the mix is the one that also
    follows the quiet source: its dB envelope correlates with every other track, a single source only with
    the mix. On a tie (two copies of one signal) the earlier one goes: OBS puts the mix on track 1.
    """
    roles = ["silent" if active_share(lv) < SILENT_SHARE else "speech" for lv in levels]
    usable = [i for i, r in enumerate(roles) if r == "speech"]
    if len(usable) < 2:
        return roles
    n = min(levels[i].size for i in usable)  # type: ignore[union-attr]
    env = {i: levels[i][:n].astype(np.float64) for i in usable}  # type: ignore[index]
    env_db = {i: _db(env[i]) for i in usable}
    while True:
        speech = [i for i in usable if roles[i] == "speech"]
        if len(speech) < 2:
            break
        candidates = []
        for i in speech:
            others = [j for j in speech if j != i]
            combined = np.sqrt(sum(env[j] ** 2 for j in others))
            if _corr(env[i], combined) >= SAME_SIGNAL_CORRELATION:
                candidates.append(i)
        if not candidates:
            break
        follows = {i: round(sum(_corr(env_db[i], env_db[j]) for j in speech if j != i), 2) for i in candidates}
        pick = max(candidates, key=lambda i: (follows[i], -i))
        roles[pick] = "mix" if len(speech) > 2 else "duplicate"
    return roles


# ------------------------------------------------------------------ merging
def merge_track_results(per_track: list[tuple[int, dict]]) -> dict:
    """Combine pipeline results of single tracks into one transcript.

    Speaker ids are renumbered globally (track 1's SPEAKER_00 and track 2's SPEAKER_00 are different people)
    and every segment records the stream it came from. Returns segments sorted by time, the speaker ids per
    track and the renamed embeddings.
    """
    segments: list[dict] = []
    embeddings: dict[str, list[float]] = {}
    track_speakers: dict[int, list[str]] = {}
    counter = 0
    for index, result in per_track:
        mapping: dict[str, str] = {}
        for sp in result.get("speakers") or []:
            if sp != "UNKNOWN" and sp not in mapping:
                mapping[sp] = f"SPEAKER_{counter:02d}"
                counter += 1
        for seg in result.get("segments") or []:
            sp = seg.get("speaker") or "UNKNOWN"
            if sp != "UNKNOWN" and sp not in mapping:
                mapping[sp] = f"SPEAKER_{counter:02d}"
                counter += 1
        rename = lambda sp: mapping.get(sp, sp) if sp else sp  # noqa: E731
        for seg in result.get("segments") or []:
            seg = dict(seg)
            seg["speaker"] = rename(seg.get("speaker")) or "UNKNOWN"
            seg["track"] = index
            if seg.get("words"):
                seg["words"] = [{**w, "speaker": rename(w.get("speaker"))} for w in seg["words"]]
            segments.append(seg)
        for sp, vec in (result.get("speaker_embeddings") or {}).items():
            if sp in mapping:
                embeddings[mapping[sp]] = vec
        track_speakers[index] = list(dict.fromkeys(mapping.values()))
    segments.sort(key=lambda s: (s["start"], s["track"]))
    return {"segments": segments, "speaker_embeddings": embeddings or None, "track_speakers": track_speakers}


def _cos(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float64), np.asarray(b, dtype=np.float64)
    na, nb = np.linalg.norm(va), np.linalg.norm(vb)
    return float(va @ vb / na / nb) if na and nb else -1.0


def merge_similar_voices(segments: list[dict], embeddings: Optional[dict[str, list[float]]],
                         threshold: float) -> tuple[list[dict], Optional[dict[str, list[float]]], dict[str, str]]:
    """Join speakers whose voice embeddings are at least `threshold` similar: one person split in two by the
    diarizer (a change of headset mid-call), or heard on two tracks. Returns segments, embeddings and the
    applied {old id: kept id} map. threshold <= 0 disables it.
    """
    if threshold <= 0 or not embeddings or len(embeddings) < 2:
        return segments, embeddings, {}
    ids = list(embeddings)
    parent = {i: i for i in ids}

    def root(x: str) -> str:
        while parent[x] != x:
            x = parent[x]
        return x

    pairs = sorted(((_cos(embeddings[a], embeddings[b]), a, b) for i, a in enumerate(ids) for b in ids[i + 1:]), reverse=True)
    for sim, a, b in pairs:
        if sim < threshold:
            break
        ra, rb = root(a), root(b)
        if ra != rb:
            parent[max(ra, rb)] = min(ra, rb)
    mapping = {i: root(i) for i in ids if root(i) != i}
    if not mapping:
        return segments, embeddings, {}
    rename = lambda sp: mapping.get(sp, sp) if sp else sp  # noqa: E731
    out = []
    for seg in segments:
        seg = dict(seg)
        seg["speaker"] = rename(seg["speaker"])
        if seg.get("words"):
            seg["words"] = [{**w, "speaker": rename(w.get("speaker"))} for w in seg["words"]]
        out.append(seg)
    groups: dict[str, list[list[float]]] = {}
    for i in ids:
        groups.setdefault(root(i), []).append(embeddings[i])
    merged = {k: [round(float(x), 5) for x in np.mean(np.asarray(v, dtype=np.float64), axis=0)] for k, v in groups.items()}
    return out, merged, mapping


def renumber_speakers(segments: list[dict], embeddings: Optional[dict[str, list[float]]],
                      track_speakers: dict[int, list[str]]) -> tuple[list[dict], Optional[dict], dict[int, list[str]]]:
    """SPEAKER_00, SPEAKER_01, ... by first appearance, so gaps left by merging disappear."""
    order: dict[str, str] = {}
    for seg in segments:
        sp = seg["speaker"]
        if sp != "UNKNOWN" and sp not in order:
            order[sp] = f"SPEAKER_{len(order):02d}"
    rename = lambda sp: order.get(sp, sp) if sp else sp  # noqa: E731
    out = []
    for seg in segments:
        seg = dict(seg)
        seg["speaker"] = rename(seg["speaker"])
        if seg.get("words"):
            seg["words"] = [{**w, "speaker": rename(w.get("speaker"))} for w in seg["words"]]
        out.append(seg)
    emb = {order[k]: v for k, v in (embeddings or {}).items() if k in order} or None
    tracks = {t: list(dict.fromkeys(rename(s) for s in sps if s in order)) for t, sps in track_speakers.items()}
    return out, emb, tracks


def _norm(text: str) -> str:
    return re.sub(r"[^\w\s]", "", text.lower()).strip()


def _segment_level(levels: Optional[np.ndarray], start: float, end: float) -> float:
    if levels is None or levels.size == 0:
        return -100.0
    a = max(0, int(start / QUALITY_FRAME_SECONDS))
    b = max(a + 1, int(math.ceil(end / QUALITY_FRAME_SECONDS)))
    chunk = levels[a:b]
    if chunk.size == 0:
        return -100.0
    return float(_db(np.array([math.sqrt(float(np.mean(chunk.astype(np.float64) ** 2)))]))[0])


def drop_bleed(segments: list[dict], levels: dict[int, Optional[np.ndarray]]) -> tuple[list[dict], int]:
    """Remove segments heard on two tracks at once (a microphone picking up the loudspeaker, a headset
    leaking): same words, overlapping in time, on different tracks. The copy on the track where it was
    quieter in the original recording goes. Segments must be sorted by start."""
    drop: set[int] = set()
    for i, a in enumerate(segments):
        if i in drop:
            continue
        for j in range(i + 1, len(segments)):
            b = segments[j]
            if b["start"] >= a["end"]:
                break
            if j in drop or a.get("track") == b.get("track"):
                continue
            overlap = min(a["end"], b["end"]) - max(a["start"], b["start"])
            shorter = max(1e-3, min(a["end"] - a["start"], b["end"] - b["start"]))
            if overlap / shorter < BLEED_MIN_OVERLAP:
                continue
            ta, tb = _norm(a["text"]), _norm(b["text"])
            if not ta or not tb or SequenceMatcher(None, ta, tb).ratio() < BLEED_TEXT_SIMILARITY:
                continue
            la = _segment_level(levels.get(a["track"]), a["start"], a["end"])
            lb = _segment_level(levels.get(b["track"]), b["start"], b["end"])
            if lb > la:
                drop.add(i)
                break
            drop.add(j)
    return [s for k, s in enumerate(segments) if k not in drop], len(drop)
