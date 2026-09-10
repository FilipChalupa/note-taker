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


def test_metrics_record_and_snapshot(tmp_path):
    from worker.metrics import Metrics

    m = Metrics(tmp_path / "metrics.json")
    m.record(kind="transcribe", audio_seconds=600, processing_seconds=30, failed=False)
    m.record(kind="diarize", audio_seconds=600, processing_seconds=10, failed=False)
    m.record(kind="transcribe", audio_seconds=100, processing_seconds=5, failed=True)
    snap = m.snapshot()
    assert snap["totals"]["completed"] == 2 and snap["totals"]["failed"] == 1 and snap["totals"]["diarize_only"] == 1
    assert snap["totals"]["audio_seconds"] == 1200
    assert snap["speed_rtf"] == round(1200 / 45, 1)
    assert 0.3 < snap["failure_rate"] < 0.34
    assert len(snap["days"]) == 1 and snap["days"][0]["completed"] == 2
    # persisted
    assert Metrics(tmp_path / "metrics.json").totals["completed"] == 2
