from worker.stats import DEFAULT_RTF, Stats


def test_first_sample_replaces_default_then_ema(tmp_path):
    s = Stats(tmp_path / "stats.json")
    assert s.rtf["TRANSCRIBING"] == DEFAULT_RTF["TRANSCRIBING"]
    s.record("TRANSCRIBING", audio_seconds=600, wall_seconds=20)  # 30x
    assert s.rtf["TRANSCRIBING"] == 30
    s.record("TRANSCRIBING", audio_seconds=600, wall_seconds=60)  # 10x -> EMA
    assert 10 < s.rtf["TRANSCRIBING"] < 30
    assert s.expected_seconds("TRANSCRIBING", 300) == 300 / s.rtf["TRANSCRIBING"]


def test_tiny_samples_and_unknown_phases_are_ignored(tmp_path):
    s = Stats(tmp_path / "stats.json")
    s.record("TRANSCRIBING", audio_seconds=1.0, wall_seconds=5)
    s.record("NOPE", audio_seconds=100, wall_seconds=5)
    assert s.rtf["TRANSCRIBING"] == DEFAULT_RTF["TRANSCRIBING"]
    assert s.expected_seconds("TRANSCRIBING", None) is None


def test_stats_persist(tmp_path):
    p = tmp_path / "stats.json"
    Stats(p).record("DIARIZING", 100, 2)
    assert Stats(p).rtf["DIARIZING"] == 50
