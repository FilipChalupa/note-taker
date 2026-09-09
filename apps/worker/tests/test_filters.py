from worker.pipeline import _filter_hallucinations, _short_error


def seg(i, text, dur=0.5):
    return {"start": float(i), "end": float(i) + dur, "speaker": "S", "text": text}


def test_repeated_short_phrase_is_collapsed_to_first():
    segs = [seg(i, "Konec.") for i in range(5)] + [seg(9, "Jo, Marta.")]
    out = _filter_hallucinations(segs)
    assert [s["text"] for s in out] == ["Konec.", "Jo, Marta."]


def test_two_repeats_are_kept():
    segs = [seg(0, "Ano."), seg(1, "Ano."), seg(2, "Dobře.")]
    assert [s["text"] for s in _filter_hallucinations(segs)] == ["Ano.", "Ano.", "Dobře."]


def test_known_credit_phrases_are_dropped():
    segs = [seg(0, "Titulky vytvořil JohnyX"), seg(1, "Thanks for watching!"), seg(2, "Normální věta.")]
    assert [s["text"] for s in _filter_hallucinations(segs)] == ["Normální věta."]


def test_impossible_speaking_rate_is_dropped():
    fast = seg(0, "jedna dva tři čtyři pět šest sedm osm devět deset", dur=0.4)
    normal = seg(1, "jedna dva tři čtyři pět šest sedm osm devět deset", dur=4.0)
    assert [s["text"] for s in _filter_hallucinations([fast, normal])] == [normal["text"]]


def test_long_repeated_sentences_are_not_touched():
    text = "Tohle je dlouhá věta, která se klidně může opakovat vícekrát."
    segs = [seg(i, text, dur=3) for i in range(4)]
    assert len(_filter_hallucinations(segs)) == 4


def test_short_error_picks_gated_line():
    err = RuntimeError("403 Client Error\n\nCannot access gated repo for url https://x\nmore text")
    assert _short_error(err).startswith("RuntimeError: Cannot access gated repo")
